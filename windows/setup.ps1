# One-time setup for the BerryTunes server.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File windows\setup.ps1
$ErrorActionPreference = 'Stop'
$server = Join-Path (Split-Path -Parent $PSScriptRoot) 'server'

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Test-Tool($exe, $versionArg) {
    $ErrorActionPreference = 'Continue'
    try {
        & $exe $versionArg *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Ensure-Tool($name, $exe, $versionArg, $wingetId) {
    if (Test-Tool $exe $versionArg) {
        Write-Host "[ok] $name" -ForegroundColor Green
        return
    }
    Write-Host "[..] Installing $name" -ForegroundColor Yellow
    winget install --id $wingetId --exact --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Test-Tool $exe $versionArg)) {
        throw "$name installed but isn't on PATH yet. Close this window, open a new PowerShell, and run setup again."
    }
}

# Python runs the server; ffmpeg converts audio; Deno lets yt-dlp solve YouTube's JavaScript checks.
Ensure-Tool 'Python'    'python'    '--version' 'Python.Python.3.12'
Ensure-Tool 'ffmpeg'    'ffmpeg'    '-version'  'Gyan.FFmpeg'
Ensure-Tool 'Deno'      'deno'      '--version' 'DenoLand.Deno'
Ensure-Tool 'Tailscale' 'tailscale' 'version'   'Tailscale.Tailscale'

Write-Host '[..] Creating Python environment' -ForegroundColor Yellow
$venvPython = Join-Path $server '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    python -m venv (Join-Path $server '.venv')
}
& $venvPython -m pip install --quiet --upgrade pip
& $venvPython -m pip install --quiet -r (Join-Path $server 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Installing Python packages failed (see above).' }
Write-Host '[ok] Python packages installed' -ForegroundColor Green

Write-Host ''
Write-Host '[..] Sharing the app over Tailscale (private to your devices)' -ForegroundColor Yellow
Write-Host '     If Tailscale asks you to log in or enable HTTPS, follow the link it prints, then re-run this script.'
tailscale serve --bg 8765
tailscale serve status

Write-Host ''
Write-Host 'Done. Next:' -ForegroundColor Green
Write-Host '  1. Start the server now:        powershell -ExecutionPolicy Bypass -File windows\start.ps1'
Write-Host '  2. Start it at every login:     powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1'
Write-Host '  3. Open the https://....ts.net address shown above in Safari on your iPhone, then Share > Add to Home Screen.'
