# D65: run tools/measure_routes.py on the running server (as the worker user, with the worker's venv, models and keys)
# for a labelled sample, and copy the measurement back. Costs: one Street View photo per sampled building (Google) and two
# Nova Lite calls per building (AWS); the photos are deleted on the server at the end.
#   tools\deploy\measure_routes.ps1 [-Sample data\measure\ward29_routing_sample.json] [-Out data\measure\ward29_routing_server.json]
param([string]$Sample = 'data\measure\ward29_routing_sample.json', [string]$Out = 'data\measure\ward29_routing_server.json',
      [switch]$LocalOnly)   # -LocalOnly: the local steps only (no Nova call)
. "$PSScriptRoot\common.ps1"
if (-not (Wait-Ssh 60)) { throw 'The server does not answer SSH (status.ps1 / start.ps1).' }
Copy-ToServer (Join-Path $Repo $Sample) '/tmp/gc-measure-sample.json'
$lo = if ($LocalOnly) { 'LOCAL_ONLY=1 ' } else { '' }
$cmd = 'sudo chmod 644 /tmp/gc-measure-sample.json && sudo -u gcworker env ' + $lo + 'HOME=/var/lib/gc-worker ' +
       'YOLO_CONFIG_DIR=/var/lib/gc-worker/ultralytics USE_TF=0 TRANSFORMERS_NO_TF=1 PYTHONUTF8=1 ' +
       'GC_ASSETS_DIR=/opt/geo-cascadia/assets GC_OCR_PYTHON=/opt/geo-cascadia/venv-ocr/bin/python ' +
       '/opt/geo-cascadia/venv-worker/bin/python /opt/geo-cascadia/current/tools/measure_routes.py ' +
       '/tmp/gc-measure-sample.json /var/lib/gc-worker/gc-measure-out.json && ' +
       'sudo cp /var/lib/gc-worker/gc-measure-out.json /tmp/gc-measure-out.json && sudo chmod 644 /tmp/gc-measure-out.json'
if ((Invoke-Remote $cmd) -ne 0) { throw 'The measurement failed on the server (see above).' }
$ErrorActionPreference = 'Continue'
$s = Get-State
& scp -q -i $s.pem -o "UserKnownHostsFile=$KnownHosts" -o BatchMode=yes "ubuntu@$($s.elastic_ip):/tmp/gc-measure-out.json" (Join-Path $Repo $Out)
if ($LASTEXITCODE -ne 0) { throw 'Copying the measurement back failed.' }
Invoke-Remote 'sudo rm -f /tmp/gc-measure-sample.json /tmp/gc-measure-out.json /var/lib/gc-worker/gc-measure-out.json' | Out-Null
Write-Host "Measurement saved to $Out"
