# Copy fresh Builder-role AWS keys (Amazon Nova, the worker only) to the server (D63).
#   1. paste new keys from the AWS access portal into C:\projects\aws_builder.env
#   2. tools\deploy\refresh_keys.ps1            (restarts the worker when it is idle)
#      tools\deploy\refresh_keys.ps1 -Force     (restart even during a job: it resumes from its saved files)
# A worker that paused a job on expired keys picks the new file up by itself and continues the same job; an idle one
# also reads it before its next job, so the restart is only a clean start. The keys are never printed or stored locally
# anywhere else; they go over SSH to /etc/geo-cascadia/aws_builder.env (600, worker user).
param([switch]$Force, [switch]$NoCheck)
. "$PSScriptRoot\common.ps1"
if (-not (Test-Path $BuilderKeys)) { throw "$BuilderKeys not found." }
$lines = @(Get-Content $BuilderKeys | Where-Object { $_ -match '^\s*(export\s+)?AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\s*=\s*\S' })
if ($lines.Count -lt 2) { throw "$BuilderKeys lacks AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY." }
if (-not $NoCheck) {
    Write-Host 'Checking the keys with one tiny Amazon Nova call (about $0.000001)...'
    Invoke-Ops nova -Keys $BuilderKeys
}
$code = Send-Remote $lines 'sudo bash /opt/geo-cascadia/current/deploy/put_env.sh aws_builder.env'
if ($code -ne 0) { throw 'Could not write the keys on the server (is it running? status.ps1).' }
$busy = $false
try { $busy = [bool](Invoke-RestMethod -Uri "http://$(Get-Ip)/api/worker/status" -TimeoutSec 15).job } catch { }
if ($busy -and -not $Force) {
    Write-Host 'The worker is running a job: not restarted. It uses the new keys when the job pauses for expired keys, and from its next job on (-Force restarts now; the job resumes).'
} else {
    if ((Invoke-Remote 'sudo systemctl restart geo-cascadia-worker.service') -ne 0) { throw 'Worker restart failed.' }
    Write-Host 'Worker restarted with the new keys. It shows "online" in the app within about 2 minutes (it loads its models first).'
}
