# Start the server (D63): start the instance, wait until the site answers, re-arm the 90-minute auto-stop.
# Costs money while it runs: g4dn.xlarge $0.579/hour (ap-south-1 list price). Stop it with stop.ps1 when done;
# it stops by itself 90 minutes after start (extend.ps1 adds time).
. "$PSScriptRoot\common.ps1"
$s = Get-State
if (-not $s -or -not $s.instance_id) { throw 'No server has been launched yet (launch.ps1).' }
try { Invoke-Ops 'ssh-ip' }                  # your home IP may have changed: the SSH rule follows it (free)
catch { Write-Host "Could not update the SSH rule ($($_.Exception.Message)); SSH may fail if your IP changed." -ForegroundColor Yellow }
Invoke-Ops start
Write-Host "Instance $($s.instance_id) | Elastic IP $($s.elastic_ip)"
if (-not (Wait-Ssh 300)) { throw 'The server does not answer SSH after 5 minutes. Run stop.ps1 if you are not going to look into it now.' }
if ((Invoke-Remote 'sudo /usr/local/sbin/gc-autostop arm 90') -ne 0) { throw 'Could not arm the auto-stop: run stop.ps1 now.' }
Write-Host 'Waiting for the site...'
$h = Wait-Healthy 300
Show-Health $h
if ($h -and -not $h.worker_online) {
    Write-Host 'Waiting for the analysis worker (it loads its models, ~1-2 min)...'
    $t = Get-Date
    while (((Get-Date) - $t).TotalSeconds -lt 240) {
        Start-Sleep 10
        $h = Get-Health
        if ($h -and $h.worker_online) { break }
    }
    Show-Health $h
}
Write-Host "Site: http://$($s.elastic_ip)/"
