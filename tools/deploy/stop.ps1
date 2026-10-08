# Stop the server (D63) and wait until AWS says "stopped". Stopped = no instance charge; the disk ($9.12/month) and the
# Elastic IP ($0.005/hour) are still billed. Safe to run at any time; starting again is start.ps1.
. "$PSScriptRoot\common.ps1"
$s = Get-State
if (-not $s -or -not $s.instance_id) { Write-Host 'No server has been launched (no state file): nothing to stop.'; return }
Invoke-Ops stop
Invoke-Ops status
