# Build the deploy bundle (D63): C:\projects\geo-cascadia-deploy\gc-bundle.tar.gz (+ gc-assets.tar.gz). No AWS cost.
#   tools\deploy\make_bundle.ps1                 # from the committed code (refuses uncommitted changes)
#   tools\deploy\make_bundle.ps1 -NoAssets       # code only (the server keeps its model files)
#   tools\deploy\make_bundle.ps1 -AllowDirty     # test bundle from uncommitted changes
# Model files: C:\projects\geo-cascadia-assets laid out like the Drive folder MyDrive/alldataset:
#   training_runs\v8s_640_s2\weights\best.pt (or C:\projects\gc-detector\best.pt), models\use_router.joblib,
#   crops_building_v1\w1236978105.jpg, crops_building_v1\w1247744938.jpg
param([switch]$NoAssets, [switch]$AllowDirty, [string]$Assets = 'C:\projects\geo-cascadia-assets')
. "$PSScriptRoot\common.ps1"
$py = Join-Path $Repo 'backend\.venv\Scripts\python.exe'
$a = @("$PSScriptRoot\make_bundle.py", '--out', $OutDir, '--assets', $Assets)
if ($NoAssets) { $a += '--no-assets' }
if ($AllowDirty) { $a += '--allow-dirty' }
& $py @a
if ($LASTEXITCODE -ne 0) { throw 'Bundle not built (see the message above).' }
