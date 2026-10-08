# Deploy to the running server (D63): build the bundle, upload it, install it as a new release, restart, health check.
#   tools\deploy\deploy.ps1                       # an update (code + web + data files); the server keeps its model files
#   tools\deploy\deploy.ps1 -Setup -Env -Assets   # first time: also the model files, the server env, and setup.sh
#   tools\deploy\deploy.ps1 -Env                  # after changing backend\.env (Supabase / Google keys / token)
#   -NoBuild: send the last bundle again;  -AllowDirty: a test bundle from uncommitted changes
# The server env (app.env) is made from backend\.env: only the settings the API needs (no AWS keys, no laptop paths),
# plus CORS_ORIGINS = the site's address. It goes over SSH to /etc/geo-cascadia/app.env (600); values are never printed.
param([switch]$Setup, [switch]$Env, [switch]$Assets, [switch]$NoBuild, [switch]$AllowDirty)
. "$PSScriptRoot\common.ps1"
$ip = Get-Ip
if (-not $NoBuild) {
    $mb = @{}
    if (-not $Assets) { $mb.NoAssets = $true }
    if ($AllowDirty) { $mb.AllowDirty = $true }
    & "$PSScriptRoot\make_bundle.ps1" @mb
}
$bundle = Join-Path $OutDir 'gc-bundle.tar.gz'
$assetsTar = Join-Path $OutDir 'gc-assets.tar.gz'
if (-not (Test-Path $bundle)) { throw "No bundle at $bundle." }
if ($Assets -and -not (Test-Path $assetsTar)) { throw "No model files bundle at $assetsTar (make_bundle.ps1 without -NoAssets)." }
if (-not (Wait-Ssh 60)) { throw "The server at $ip does not answer SSH (status.ps1 / start.ps1)." }

Write-Host 'Uploading...'
Copy-ToServer $bundle '/tmp/gc-bundle.tar.gz'
$assetArg = ''
if ($Assets) { Copy-ToServer $assetsTar '/tmp/gc-assets.tar.gz'; $assetArg = ' /tmp/gc-assets.tar.gz' }
$install = 'rm -rf /tmp/gc-x && mkdir -p /tmp/gc-x && tar -xzf /tmp/gc-bundle.tar.gz -C /tmp/gc-x --wildcards ''deploy/*'' && ' +
           "sudo bash /tmp/gc-x/deploy/install_release.sh /tmp/gc-bundle.tar.gz$assetArg"
if ((Invoke-Remote $install) -ne 0) { throw 'Installing the release failed (see above).' }

if ($Env) {
    $allowed = 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_BUCKET', 'GOOGLE_MAPS_BROWSER_KEY',
               'GOOGLE_MAP_ID', 'GOOGLE_PLACES_SERVER_KEY', 'WORKER_TOKEN', 'JOB_COST_CAP_USD', 'LOCAL_MAP_DATA'
    $lines = @(Get-Content (Join-Path $Repo 'backend\.env') | Where-Object {
        $_ -match '^\s*([A-Z_]+)\s*=' -and $allowed -contains $Matches[1] })
    $names = $lines | ForEach-Object { ($_ -split '=', 2)[0].Trim() }
    $lines += "CORS_ORIGINS=http://$ip"
    if ((Send-Remote $lines 'sudo bash /opt/geo-cascadia/current/deploy/put_env.sh app.env') -ne 0) { throw 'Writing app.env failed.' }
    Write-Host "app.env: $($names -join ', '), CORS_ORIGINS"
}
if ($Setup) {
    if ((Invoke-Remote 'sudo bash /opt/geo-cascadia/current/deploy/setup.sh') -ne 0) { throw 'setup.sh failed (see above).' }
}
Invoke-Remote 'rm -rf /tmp/gc-x /tmp/gc-bundle.tar.gz /tmp/gc-assets.tar.gz' | Out-Null
Write-Host 'Waiting for the site...'
Show-Health (Wait-Healthy 300)
Write-Host "Site: http://$ip/"
