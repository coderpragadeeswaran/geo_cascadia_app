"""AWS operations for the one-server deployment (D63). Called by the tools/deploy/*.ps1 scripts; runs in its own small venv
(C:\\projects\\gc-deploy\\.venv, boto3 only), never in the API's venv.

Keys: read from the env file given with --keys (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN), held in
memory for this process only, never printed, never written. An expired-token answer exits with code 3 and a plain line.
State (instance id, Elastic IP, security group, key name; nothing secret) lives OUTSIDE the repo, in
C:\\projects\\geo-cascadia-keys\\deploy_state.json.

Money: only `launch` and `eip` create anything that costs money. `launch` refuses without --approved, refuses when the
state file already names an instance, and refuses when any instance tagged with the project exists (one instance, ever).
"""
import argparse
import json
import os
import sys
import time
import urllib.request

REGION = "ap-south-1"
PROJECT = "fai-tce-team-22-geo-cascadia"
TAGS = [{"Key": "Project", "Value": PROJECT}, {"Key": "Name", "Value": "geo-cascadia"}]
ITYPE = "g4dn.xlarge"
AMI_NAME = "Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04) *"
DISK_GB = 100
KEYS_DIR = r"C:\projects\geo-cascadia-keys"
STATE = os.path.join(KEYS_DIR, "deploy_state.json")
KEY_NAME = "geo-cascadia-team22"
SG_NAME = "geo-cascadia-web"
AUTOSTOP_MIN = 90
EXPIRED = ("ExpiredToken", "RequestExpired", "InvalidClientTokenId", "UnrecognizedClientException", "AuthFailure")

# First boot only (cloud-init): install and arm the auto-stop before anything else, from the same files setup.sh installs
# (tools/deploy/server/gc-autostop*), so every later boot re-arms it too. Power-off = stop (InstanceInitiatedShutdownBehavior).
SERVER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server")


def user_data():
    def body(name):
        with open(os.path.join(SERVER_DIR, name), encoding="utf-8", newline="") as fh:
            return fh.read().replace("\r\n", "\n")                 # a Windows checkout may have CRLF; bash must not
    parts = ["#!/bin/bash", "set -e"]
    for name, dest, mode in (("gc-autostop", "/usr/local/sbin/gc-autostop", "755"),
                             ("gc-autostop-arm.service", "/etc/systemd/system/gc-autostop-arm.service", "644"),
                             ("gc-autostop.service", "/etc/systemd/system/gc-autostop.service", "644"),
                             ("gc-autostop.timer", "/etc/systemd/system/gc-autostop.timer", "644")):
        parts += [f"cat > {dest} <<'GC_EOF'", body(name).rstrip("\n"), "GC_EOF", f"chmod {mode} {dest}"]
    parts += ["systemctl daemon-reload", "systemctl enable gc-autostop-arm.service gc-autostop.timer",
              f"/usr/local/sbin/gc-autostop arm {AUTOSTOP_MIN}", "systemctl start gc-autostop.timer"]
    return "\n".join(parts) + "\n"


# ------------------------------------------------------------------------------------------------ keys and clients
def read_keys(path):
    """KEY=value lines; quotes and spaces removed (D37's rule for pasted keys). Values never leave this process."""
    if not os.path.isfile(path):
        sys.exit(f"Key file not found: {path}")
    k = {}
    for line in open(path, encoding="utf-8-sig"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, val = line.partition("=")
        k[name.strip().removeprefix("export ").strip()] = "".join(val.split()).strip("'\"")
    need = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY")
    if not all(k.get(n) for n in need):
        sys.exit(f"{path} lacks AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY")
    return k


def session(path):
    import boto3
    k = read_keys(path)
    return boto3.Session(aws_access_key_id=k["AWS_ACCESS_KEY_ID"], aws_secret_access_key=k["AWS_SECRET_ACCESS_KEY"],
                         aws_session_token=k.get("AWS_SESSION_TOKEN") or None, region_name=REGION)


def code_of(e):
    return getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)


def expired_exit(e, path):
    if code_of(e) in EXPIRED or "expired" in str(e).lower():
        print(f"EXPIRED: the keys in {path} are expired or invalid ({code_of(e)}). Refresh that file from the AWS access "
              "portal, then run the command again.")
        sys.exit(3)


def load_state():
    return json.load(open(STATE)) if os.path.isfile(STATE) else {}


def save_state(s):
    os.makedirs(KEYS_DIR, exist_ok=True)
    json.dump(s, open(STATE, "w"), indent=1)


def my_ip():
    return urllib.request.urlopen("https://checkip.amazonaws.com", timeout=10).read().decode().strip()


def latest_ami(ec2):
    imgs = ec2.describe_images(Owners=["amazon"], Filters=[{"Name": "name", "Values": [AMI_NAME]},
                                                           {"Name": "architecture", "Values": ["x86_64"]},
                                                           {"Name": "state", "Values": ["available"]}])["Images"]
    if not imgs:
        return None
    return max(imgs, key=lambda i: i["CreationDate"])


def project_instances(ec2):
    r = ec2.describe_instances(Filters=[{"Name": "tag:Project", "Values": [PROJECT]},
                                        {"Name": "instance-state-name",
                                         "Values": ["pending", "running", "stopping", "stopped", "shutting-down"]}])
    return [i for res in r["Reservations"] for i in res["Instances"]]


# ------------------------------------------------------------------------------------------------ read-only checks
def cmd_checks(a):
    """Phase 1: identity, g4dn.xlarge offered + dry run, latest AMI, G-instance vCPU quota, RDS visibility, prices."""
    s = session(a.keys)
    from botocore.exceptions import ClientError
    out = {}
    try:
        idt = s.client("sts").get_caller_identity()
    except ClientError as e:
        expired_exit(e, a.keys); raise
    out["identity"] = {"account": idt["Account"], "arn": idt["Arn"]}
    ec2 = s.client("ec2")
    off = ec2.describe_instance_type_offerings(LocationType="availability-zone",
                                               Filters=[{"Name": "instance-type", "Values": [ITYPE]}])["InstanceTypeOfferings"]
    out["g4dn_xlarge_zones"] = sorted(o["Location"] for o in off)
    ami = latest_ami(ec2)
    out["ami"] = ami and {"id": ami["ImageId"], "name": ami["Name"], "created": ami["CreationDate"],
                          "root_device": ami.get("RootDeviceName"),
                          "root_gb": next((m["Ebs"]["VolumeSize"] for m in ami.get("BlockDeviceMappings", [])
                                           if m.get("DeviceName") == ami.get("RootDeviceName") and "Ebs" in m), None)}
    if ami:
        try:
            ec2.run_instances(DryRun=True, ImageId=ami["ImageId"], InstanceType=ITYPE, MinCount=1, MaxCount=1,
                              InstanceInitiatedShutdownBehavior="stop", UserData=user_data(),
                              MetadataOptions={"HttpTokens": "required"},
                              BlockDeviceMappings=[{"DeviceName": ami["RootDeviceName"],
                                                    "Ebs": {"VolumeSize": DISK_GB, "VolumeType": "gp3",
                                                            "DeleteOnTermination": True}}],
                              TagSpecifications=[{"ResourceType": "instance", "Tags": TAGS}])   # exactly as launch
            out["dry_run"] = "unexpected: no DryRunOperation answer"
        except ClientError as e:
            c = code_of(e)
            out["dry_run"] = "OK (DryRunOperation: the launch would be allowed)" if c == "DryRunOperation" else \
                f"REFUSED: {c}: {str(e)[:300]}"
    for name, fn in (("vpcs_default", lambda: [v["VpcId"] for v in ec2.describe_vpcs(
                         Filters=[{"Name": "is-default", "Values": ["true"]}])["Vpcs"]]),
                     ("project_instances", lambda: [(i["InstanceId"], i["State"]["Name"]) for i in project_instances(ec2)]),
                     ("elastic_ips", lambda: len(ec2.describe_addresses()["Addresses"])),
                     ("key_pair_exists", lambda: bool(ec2.describe_key_pairs(
                         Filters=[{"Name": "key-name", "Values": [KEY_NAME]}])["KeyPairs"]))):
        try:
            out[name] = fn()
        except ClientError as e:
            out[name] = f"not allowed: {code_of(e)}"
    try:
        q = s.client("service-quotas").get_service_quota(ServiceCode="ec2", QuotaCode="L-DB2E81BA")["Quota"]
        out["quota_running_G_vcpus"] = q["Value"]
    except ClientError as e:
        out["quota_running_G_vcpus"] = f"not readable: {code_of(e)}"
    rds = s.client("rds")
    try:
        out["rds_instances_visible"] = [d["DBInstanceIdentifier"] for d in rds.describe_db_instances()["DBInstances"]]
    except ClientError as e:
        out["rds_instances_visible"] = f"not allowed: {code_of(e)}"
    try:   # creatable? read-only: an orderable-options answer means the API is reachable for this role (not a permission)
        o = rds.describe_orderable_db_instance_options(Engine="postgres", DBInstanceClass="db.t4g.micro", MaxRecords=20)
        out["rds_orderable_postgres_t4g_micro"] = bool(o["OrderableDBInstanceOptions"])
    except ClientError as e:
        out["rds_orderable_postgres_t4g_micro"] = f"not allowed: {code_of(e)}"
    out["prices"] = prices(s)
    print(json.dumps(out, indent=1, default=str))


def prices(s):
    """On-demand list prices from the AWS Price List API (read-only). None where the role can't read it."""
    from botocore.exceptions import ClientError
    try:
        pr = s.client("pricing", region_name="ap-south-1")
    except Exception as e:                                         # noqa: BLE001
        return f"not readable: {type(e).__name__}"

    def one(service, filters):
        r = pr.get_products(ServiceCode=service, MaxResults=20,
                            Filters=[{"Type": "TERM_MATCH", "Field": k, "Value": v} for k, v in filters.items()])
        res = []
        for p in r["PriceList"]:
            p = json.loads(p)
            for term in p.get("terms", {}).get("OnDemand", {}).values():
                for d in term["priceDimensions"].values():
                    res.append((d["description"], d["unit"], float(d["pricePerUnit"]["USD"])))
        return res
    try:
        ec2 = one("AmazonEC2", {"instanceType": ITYPE, "regionCode": REGION, "operatingSystem": "Linux",
                                "tenancy": "Shared", "preInstalledSw": "NA", "capacitystatus": "Used",
                                "licenseModel": "No License required"})
        gp3 = one("AmazonEC2", {"regionCode": REGION, "volumeApiName": "gp3", "productFamily": "Storage"})
        ip = one("AmazonVPC", {"regionCode": REGION, "group": "VPCPublicIPv4Address"})
        return {"g4dn_xlarge_per_hour": ec2, "gp3_per_gb_month": gp3, "public_ipv4": ip[:4]}
    except ClientError as e:
        return f"not readable: {code_of(e)}"


def cmd_nova(a):
    """Phase 1: one tiny Nova Lite call with the Builder keys (a few dozen tokens, a fraction of a cent)."""
    s = session(a.keys)
    from botocore.exceptions import ClientError
    br = s.client("bedrock-runtime")
    t = time.time()
    try:
        r = br.converse(modelId="apac.amazon.nova-lite-v1:0",
                        messages=[{"role": "user", "content": [{"text": "Reply with the single word: ready"}]}],
                        inferenceConfig={"maxTokens": 5, "temperature": 0})
    except ClientError as e:
        expired_exit(e, a.keys)
        print(f"FAILED: {code_of(e)}: {str(e)[:300]}"); sys.exit(1)
    u = r["usage"]
    usd = u["inputTokens"] / 1e6 * 0.06 + u["outputTokens"] / 1e6 * 0.24          # the pipeline's Nova Lite prices
    print(json.dumps({"answer": r["output"]["message"]["content"][0]["text"].strip(), "input_tokens": u["inputTokens"],
                      "output_tokens": u["outputTokens"], "usd": round(usd, 8), "seconds": round(time.time() - t, 2)}))


# ------------------------------------------------------------------------------------------------ the instance
def instance(ec2, iid):
    r = ec2.describe_instances(InstanceIds=[iid])["Reservations"]
    return r[0]["Instances"][0] if r else None


def cmd_status(a):
    st = load_state()
    if not st.get("instance_id"):
        print(json.dumps({"state": "not launched"})); return
    s = session(a.keys)
    from botocore.exceptions import ClientError
    try:
        i = instance(s.client("ec2"), st["instance_id"])
    except ClientError as e:
        expired_exit(e, a.keys); raise
    print(json.dumps({"instance_id": st["instance_id"], "state": i["State"]["Name"], "elastic_ip": st.get("elastic_ip"),
                      "type": i["InstanceType"], "launched": str(i["LaunchTime"])}))


def wait_state(ec2, iid, want, timeout=600):
    t = time.time()
    while time.time() - t < timeout:
        cur = instance(ec2, iid)["State"]["Name"]
        if cur == want:
            return cur
        time.sleep(5)
    return instance(ec2, iid)["State"]["Name"]


def cmd_stop(a):
    st = load_state()
    if not st.get("instance_id"):
        print("No instance in the state file: nothing to stop."); return
    s = session(a.keys)
    from botocore.exceptions import ClientError
    ec2 = s.client("ec2")
    try:
        cur = instance(ec2, st["instance_id"])["State"]["Name"]
        if cur in ("running", "pending"):
            ec2.stop_instances(InstanceIds=[st["instance_id"]])
        print(f"{st['instance_id']}: {cur} -> waiting for 'stopped'…", flush=True)
        print(f"{st['instance_id']}: {wait_state(ec2, st['instance_id'], 'stopped')}")
    except ClientError as e:
        expired_exit(e, a.keys); raise


def cmd_start(a):
    st = load_state()
    if not st.get("instance_id"):
        sys.exit("No instance in the state file (launch first).")
    s = session(a.keys)
    from botocore.exceptions import ClientError
    ec2 = s.client("ec2")
    try:
        ec2.start_instances(InstanceIds=[st["instance_id"]])
        print(f"{st['instance_id']}: {wait_state(ec2, st['instance_id'], 'running')}  Elastic IP {st.get('elastic_ip')}")
    except ClientError as e:
        expired_exit(e, a.keys); raise


def cmd_launch(a):
    """Phase 2 only, after the owner's explicit OK (the .ps1 asks too). Key pair, security group (80 open, 22 from this
    PC's IP), ONE g4dn.xlarge with the latest Deep Learning Base GPU AMI and a 100 GB gp3 disk, Elastic IP; everything
    tagged; the auto-stop is armed by the user data on first boot."""
    if not a.approved:
        sys.exit("Refused: launch costs money; it needs --approved (tools/deploy/launch.ps1 asks the owner first).")
    st = load_state()
    if st.get("instance_id"):
        sys.exit(f"Refused: the state file already names instance {st['instance_id']} (one instance only).")
    s = session(a.keys)
    from botocore.exceptions import ClientError
    ec2 = s.client("ec2")
    try:
        others = project_instances(ec2)
        if others:
            sys.exit(f"Refused: an instance tagged {PROJECT} already exists: {[i['InstanceId'] for i in others]}")
        ami = latest_ami(ec2)
        ip = my_ip()
        os.makedirs(KEYS_DIR, exist_ok=True)
        pem = os.path.join(KEYS_DIR, f"{KEY_NAME}.pem")
        if not ec2.describe_key_pairs(Filters=[{"Name": "key-name", "Values": [KEY_NAME]}])["KeyPairs"]:
            kp = ec2.create_key_pair(KeyName=KEY_NAME, KeyType="ed25519", KeyFormat="pem")
            st["key_pair_id"] = kp.get("KeyPairId")
            with open(pem, "w", newline="\n") as fh:
                fh.write(kp["KeyMaterial"])
        elif not os.path.isfile(pem):
            sys.exit(f"Key pair {KEY_NAME} exists in AWS but {pem} is missing: delete the key pair in AWS or restore the file.")
        vpc = ec2.describe_vpcs(Filters=[{"Name": "is-default", "Values": ["true"]}])["Vpcs"][0]["VpcId"]
        sgs = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": [SG_NAME]},
                                                    {"Name": "vpc-id", "Values": [vpc]}])["SecurityGroups"]
        if sgs:
            sg = sgs[0]["GroupId"]
        else:
            sg = ec2.create_security_group(GroupName=SG_NAME, VpcId=vpc,
                                           Description="GEO-CASCADIA web 80 + SSH from owner")["GroupId"]
            ec2.authorize_security_group_ingress(GroupId=sg, IpPermissions=[
                {"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80, "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "web"}]},
                {"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22,
                 "IpRanges": [{"CidrIp": f"{ip}/32", "Description": "owner SSH"}]}])
        r = ec2.run_instances(ImageId=ami["ImageId"], InstanceType=ITYPE, MinCount=1, MaxCount=1, KeyName=KEY_NAME,
                              SecurityGroupIds=[sg], InstanceInitiatedShutdownBehavior="stop", UserData=user_data(),
                              MetadataOptions={"HttpTokens": "required"},
                              BlockDeviceMappings=[{"DeviceName": ami["RootDeviceName"],
                                                    "Ebs": {"VolumeSize": DISK_GB, "VolumeType": "gp3",
                                                            "DeleteOnTermination": True}}],
                              TagSpecifications=[{"ResourceType": "instance", "Tags": TAGS}])   # the only tag-on-create allowed
        iid = r["Instances"][0]["InstanceId"]
        st.update(instance_id=iid, ami=ami["ImageId"], security_group=sg, key_name=KEY_NAME, pem=pem, ssh_ip=ip)
        save_state(st)
        print(f"INSTANCE {iid} launched; waiting for 'running'…", flush=True)
        wait_state(ec2, iid, "running")
        eip = ec2.allocate_address(Domain="vpc")
        ec2.associate_address(InstanceId=iid, AllocationId=eip["AllocationId"])
        st.update(elastic_ip=eip["PublicIp"], allocation_id=eip["AllocationId"])
        save_state(st)
        i = instance(ec2, iid)
        vols = [m["Ebs"]["VolumeId"] for m in i.get("BlockDeviceMappings", []) if "Ebs" in m]
        enis = [n["NetworkInterfaceId"] for n in i.get("NetworkInterfaces", [])]
        tag_after(ec2, vols + enis + [sg, eip["AllocationId"]] + ([st["key_pair_id"]] if st.get("key_pair_id") else []))
        print(f"INSTANCE {iid}  ELASTIC IP {eip['PublicIp']}  (auto-stop armed by the first boot: {AUTOSTOP_MIN} min)")
    except ClientError as e:
        expired_exit(e, a.keys); raise


def tag_after(ec2, ids):
    """The role refuses tags at creation on everything but the instance (dry-run probes, 8 Oct 2026), so the volume,
    network interface, security group, Elastic IP and key pair are tagged right after; a refusal is reported, not fatal."""
    from botocore.exceptions import ClientError
    for rid in ids:
        try:
            ec2.create_tags(Resources=[rid], Tags=TAGS)
            print(f"  tagged {rid}")
        except ClientError as e:
            print(f"  ⚠ could not tag {rid}: {code_of(e)}")


def cmd_ssh_ip(a):
    """Re-point the SSH rule at this PC's current IP (home IPs change)."""
    st = load_state()
    s = session(a.keys)
    ec2 = s.client("ec2")
    ip = my_ip()
    if ip == st.get("ssh_ip"):
        print(f"SSH rule already allows {ip}"); return
    old = st.get("ssh_ip")
    if old:
        ec2.revoke_security_group_ingress(GroupId=st["security_group"], IpPermissions=[
            {"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": f"{old}/32"}]}])
    ec2.authorize_security_group_ingress(GroupId=st["security_group"], IpPermissions=[
        {"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": f"{ip}/32", "Description": "owner SSH"}]}])
    st["ssh_ip"] = ip
    save_state(st)
    print(f"SSH rule: {old} -> {ip}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["checks", "nova", "status", "start", "stop", "launch", "ssh-ip", "state"])
    p.add_argument("--keys", default=r"C:\projects\aws_ec2.env")
    p.add_argument("--approved", action="store_true")
    a = p.parse_args()
    if a.command == "state":
        print(json.dumps(load_state())); return
    {"checks": cmd_checks, "nova": cmd_nova, "status": cmd_status, "start": cmd_start, "stop": cmd_stop,
     "launch": cmd_launch, "ssh-ip": cmd_ssh_ip}[a.command](a)


if __name__ == "__main__":
    main()
