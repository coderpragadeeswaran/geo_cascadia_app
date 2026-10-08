# Server status (D63): instance state, the site URL, API health, worker online, minutes until the auto-stop.
. "$PSScriptRoot\common.ps1"
$s = Get-State
if (-not $s -or -not $s.instance_id) { Write-Host 'No server has been launched yet (launch.ps1).'; return }
$i = Get-OpsJson status
Write-Host "Instance $($s.instance_id) | $($i.type) | state $($i.state) | Elastic IP $($s.elastic_ip) | site http://$($s.elastic_ip)/"
if ($i.state -ne 'running') { Write-Host 'Not running (start.ps1 starts it).'; return }
Show-Health (Get-Health)
try {
    $w = Invoke-RestMethod -Uri "http://$($s.elastic_ip)/api/worker/status" -TimeoutSec 15
    $dev = if ($w.device) { $w.device.ToUpper() } else { '-' }
    $job = if ($w.job) { "on a job ($($w.job))" } else { 'idle' }
    Write-Host "Worker: $(if ($w.connected) { 'connected' } else { 'not connected' }) | $dev | $job"
} catch { Write-Host 'Worker status: not available' }
Invoke-Remote 'sudo /usr/local/sbin/gc-autostop show' | Out-Null
