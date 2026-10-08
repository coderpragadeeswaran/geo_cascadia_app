# Launch THE server (D63) - costs money; only after the owner's OK. Creates: an SSH key pair (saved to
# C:\projects\geo-cascadia-keys), a security group (port 80 open, SSH only from this PC's IP), ONE g4dn.xlarge in
# ap-south-1 with the latest Deep Learning Base GPU AMI (Ubuntu 22.04) and a 100 GB gp3 disk, and an Elastic IP; all
# tagged Project=fai-tce-team-22-geo-cascadia. Shutdown = stop. The 90-minute auto-stop is armed on first boot.
# It refuses when an instance already exists (one instance only). Then: deploy.ps1 -Setup -Env -Assets, refresh_keys.ps1.
param([switch]$Yes)
. "$PSScriptRoot\common.ps1"
Write-Host @'
Cost (AWS list prices, ap-south-1, checked 8 Oct 2026):
  g4dn.xlarge (4 vCPU, 16 GB, NVIDIA T4)   $0.579 per hour while running (stopped: $0)
  100 GB gp3 disk                          $9.12 per month, running or stopped
  Elastic IP (public IPv4)                 $0.005 per hour = about $3.65 per month, running or stopped
Auto-stop: 90 minutes after every start (extend.ps1 adds 60).
'@
if (-not $Yes) {
    $ans = Read-Host 'Type LAUNCH to create ONE g4dn.xlarge now'
    if ($ans -ne 'LAUNCH') { Write-Host 'Not launched.'; return }
}
Invoke-Ops launch -Extra @('--approved')
$s = Get-State
Write-Host "INSTANCE $($s.instance_id)   ELASTIC IP $($s.elastic_ip)" -ForegroundColor Cyan
# Windows OpenSSH refuses a private key that other accounts can read
icacls $s.pem /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
Write-Host 'Waiting for SSH (first boot takes a few minutes)...'
if (-not (Wait-Ssh 600)) { throw 'No SSH after 10 minutes. Run stop.ps1 unless you are going to look into it now.' }
Invoke-Remote 'cloud-init status --wait > /dev/null' | Out-Null   # sudo works only once cloud-init has finished
for ($i = 0; $i -lt 12; $i++) {                   # the user data may still be running right after SSH comes up
    if ((Invoke-Remote 'sudo /usr/local/sbin/gc-autostop show') -eq 0) { Write-Host 'Auto-stop armed.'; return }
    Start-Sleep 10
}
Write-Host 'The auto-stop is NOT armed (user data did not run?). Stopping the server to be safe.' -ForegroundColor Red
Invoke-Ops stop
