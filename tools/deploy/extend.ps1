# Push the server's auto-stop back (D63): +60 minutes by default (from the current stop time, or from now if it passed).
#   tools\deploy\extend.ps1            # +60 min
#   tools\deploy\extend.ps1 -Minutes 30
param([int]$Minutes = 60)
. "$PSScriptRoot\common.ps1"
if ($Minutes -lt 1 -or $Minutes -gt 240) { throw 'Minutes must be 1-240.' }
$code = Invoke-Remote "sudo /usr/local/sbin/gc-autostop extend $Minutes"
if ($code -ne 0) { throw 'Could not reach the server (is it running? status.ps1).' }
