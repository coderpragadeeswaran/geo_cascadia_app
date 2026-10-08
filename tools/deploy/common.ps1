# Shared by the tools\deploy\*.ps1 scripts (D63). Dot-source it:  . "$PSScriptRoot\common.ps1"
# Keys stay in C:\projects\aws_ec2.env / aws_builder.env and are never printed. The SSH key and the state file (instance
# id, Elastic IP; nothing secret) live in C:\projects\geo-cascadia-keys, outside the repo.
$ErrorActionPreference = 'Stop'
$Repo        = (Resolve-Path "$PSScriptRoot\..\..").Path
$KeysDir     = 'C:\projects\geo-cascadia-keys'
$Ec2Keys     = 'C:\projects\aws_ec2.env'
$BuilderKeys = 'C:\projects\aws_builder.env'
$DeployVenv  = 'C:\projects\gc-deploy\.venv'
$DeployPy    = "$DeployVenv\Scripts\python.exe"
$Ops         = "$PSScriptRoot\aws_ops.py"
$KnownHosts  = "$KeysDir\known_hosts"
$OutDir      = 'C:\projects\geo-cascadia-deploy'

function Ensure-DeployVenv {
    if (-not (Test-Path $DeployPy)) {
        Write-Host 'Creating the deploy venv (boto3 only) in C:\projects\gc-deploy ...'
        py -3.12 -m venv $DeployVenv
        & $DeployPy -m pip install -q --disable-pip-version-check boto3
    }
}

function Invoke-Ops {
    param([Parameter(Mandatory)][string]$Command, [string]$Keys = $Ec2Keys, [string[]]$Extra = @())
    Ensure-DeployVenv
    & $DeployPy $Ops $Command --keys $Keys @Extra | Out-Host
    $code = $LASTEXITCODE
    if ($code -eq 3) { throw "The AWS keys in $Keys are expired: refresh that file from the AWS access portal, then run this again." }
    if ($code -ne 0) { throw "aws_ops $Command failed (exit $code)." }
}

# aws_ops commands that print one JSON object (status) -> PowerShell object
function Get-OpsJson([string]$Command, [string]$Keys = $Ec2Keys) {
    Ensure-DeployVenv
    $out = & $DeployPy $Ops $Command --keys $Keys
    if ($LASTEXITCODE -eq 3) { throw "The AWS keys in $Keys are expired: refresh that file from the AWS access portal, then run this again." }
    if ($LASTEXITCODE -ne 0) { throw "aws_ops $Command failed (exit $LASTEXITCODE)." }
    return ($out -join "`n") | ConvertFrom-Json
}

function Get-State {
    $f = Join-Path $KeysDir 'deploy_state.json'
    if (Test-Path $f) { return Get-Content $f -Raw | ConvertFrom-Json }
    return $null
}

function Get-Ip {
    $s = Get-State
    if (-not $s -or -not $s.elastic_ip) { throw 'No Elastic IP in the state file: the server has not been launched (launch.ps1).' }
    return $s.elastic_ip
}

function Get-SshArgs {
    $s = Get-State
    return @('-i', $s.pem, '-o', 'StrictHostKeyChecking=accept-new', '-o', "UserKnownHostsFile=$KnownHosts",
             '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', "ubuntu@$($s.elastic_ip)")
}

# Run one command on the server; returns its exit code (output goes to the console).
function Invoke-Remote([string]$Cmd) {
    $a = Get-SshArgs
    & ssh @a $Cmd | Out-Host
    return $LASTEXITCODE
}

# Send text to a command's stdin on the server (env files: never written to a local temp file, never printed).
function Send-Remote([string[]]$Lines, [string]$Cmd) {
    $a = Get-SshArgs
    ($Lines -join "`n") | & ssh @a $Cmd | Out-Host
    return $LASTEXITCODE
}

function Copy-ToServer([string]$Local, [string]$Remote) {
    $s = Get-State
    & scp -q -i $s.pem -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KnownHosts" -o BatchMode=yes $Local "ubuntu@$($s.elastic_ip):$Remote" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Upload of $Local failed." }
}

function Wait-Ssh([int]$Seconds = 300) {
    $t = Get-Date
    while (((Get-Date) - $t).TotalSeconds -lt $Seconds) {
        $a = @('-q') + (Get-SshArgs)
        & ssh @a 'true' | Out-Null
        if ($LASTEXITCODE -eq 0) { return $true }
        Start-Sleep 5
    }
    return $false
}

function Get-Health {
    try { return Invoke-RestMethod -Uri "http://$(Get-Ip)/api/health" -TimeoutSec 15 } catch { return $null }
}

function Wait-Healthy([int]$Seconds = 300) {
    $t = Get-Date
    while (((Get-Date) - $t).TotalSeconds -lt $Seconds) {
        $h = Get-Health
        if ($h -and $h.ok) { return $h }
        Start-Sleep 5
    }
    return $null
}

function Show-Health($h) {
    if (-not $h) { Write-Host 'API: not answering' -ForegroundColor Yellow; return }
    $db = if ($h.offline) { 'OFFLINE (read-only saved data)' } else { 'online' }
    $wk = if ($h.worker_online) { 'online' } else { 'not connected' }
    Write-Host "API ok | database $db | analysis worker $wk"
}
