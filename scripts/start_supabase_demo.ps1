param(
    [int]$ApiPort = 8797,
    [int]$FrontendPort = 5197,
    [switch]$Check,
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $environmentPath)) {
    throw 'Create the repository .env file using the Supabase local testing guide.'
}

# Read plain dotenv values; never evaluate file content as PowerShell code.
$settings = @{}
foreach ($line in Get-Content -LiteralPath $environmentPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
        throw 'The .env file contains an invalid line. Use NAME=value syntax.'
    }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
    )) { $value = $value.Substring(1, $value.Length - 2) }
    $settings[$name] = $value
}

$missing = @()
foreach ($name in @('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY')) {
    if (-not $settings[$name] -or $settings[$name] -match 'YOUR_|CHANGE_ME') { $missing += $name }
}
if ($missing.Count) {
    throw "Fill these values in ${environmentPath}: $($missing -join ', '). Keep keys local."
}
$projectUri = $null
if (-not [Uri]::TryCreate($settings['SUPABASE_URL'], [UriKind]::Absolute, [ref]$projectUri) -or
    $projectUri.Scheme -ne 'https' -or $projectUri.UserInfo -or $projectUri.Query -or
    $projectUri.Fragment -or $projectUri.AbsolutePath -ne '/') {
    throw 'SUPABASE_URL must be the HTTPS project origin, with no extra path.'
}
if ($settings['AUTH_PROVIDER'] -ne 'supabase' -or
    $settings['PHOTO_STORAGE_PROVIDER'] -ne 'supabase') {
    throw 'For this test set AUTH_PROVIDER=supabase and PHOTO_STORAGE_PROVIDER=supabase.'
}
if ($settings['SUPABASE_ACCOUNT_MANAGEMENT'] -ne 'true') {
    throw 'For registration testing set SUPABASE_ACCOUNT_MANAGEMENT=true after running the account migration.'
}
if ($ApiPort -lt 1 -or $ApiPort -gt 65535 -or $FrontendPort -lt 1 -or
    $FrontendPort -gt 65535 -or $ApiPort -eq $FrontendPort) {
    throw 'Choose distinct valid API and frontend ports.'
}
if ($Check) {
    Write-Host 'Supabase environment fields are configured. No remote service was contacted.'
    exit 0
}

# Scope configuration to this process and its demo child. No machine settings change.
foreach ($entry in $settings.GetEnumerator()) {
    if ($entry.Key -match '^(SUPABASE_|AUTH_PROVIDER$|PHOTO_STORAGE_PROVIDER$|PHOTO_|UPLOAD_|STAGE$)') {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
}

# Sync only public frontend settings. Never copy the server role key to Vite.
$frontendEnvironment = Join-Path $projectRoot 'frontend/.env.supabase.local'
$publicSettings = [ordered]@{
    VITE_API_BASE_URL = "http://localhost:$ApiPort"
    VITE_SUPABASE_URL = $settings['SUPABASE_URL'].TrimEnd('/')
    VITE_SUPABASE_PUBLISHABLE_KEY = $settings['SUPABASE_PUBLISHABLE_KEY']
}
$frontendLines = @()
if (Test-Path -LiteralPath $frontendEnvironment) {
    $frontendLines = @(Get-Content -LiteralPath $frontendEnvironment | Where-Object {
        $_ -notmatch '^\s*(VITE_API_BASE_URL|VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY)\s*='
    })
}
foreach ($entry in $publicSettings.GetEnumerator()) { $frontendLines += "$($entry.Key)=$($entry.Value)" }
[System.IO.File]::WriteAllLines($frontendEnvironment, [string[]]$frontendLines, [System.Text.UTF8Encoding]::new($false))
if ($PrepareOnly) {
    Write-Host 'Public frontend environment prepared. No server started or remote service contacted.'
    exit 0
}

$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Install requirements first: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt'
}

Write-Host "API: http://localhost:$ApiPort. Frontend: http://localhost:$FrontendPort/login."
Write-Host "In a second terminal: cd frontend; npm run dev -- --mode supabase --host localhost --port $FrontendPort --strictPort"
Push-Location $projectRoot
try {
    & $pythonPath scripts/local_demo.py --port $ApiPort --frontend-port $FrontendPort `
        --manifest .tmp/supabase-demo-access.json --photo-dir .tmp/supabase-demo-photos
    if ($LASTEXITCODE -ne 0) { throw 'Local API stopped with an error.' }
} finally { Pop-Location }
