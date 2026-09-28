# Starts the BerryTunes server. Use -Log to write output to server\logs\server.log (used by auto-start).
param([switch]$Log)
# 'Continue': uvicorn and pip write normal output to stderr, which 'Stop' would treat as fatal.
$ErrorActionPreference = 'Continue'
$server = Join-Path (Split-Path -Parent $PSScriptRoot) 'server'
$python = Join-Path $server '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Run windows\setup.cmd first.' }
Set-Location $server

# YouTube changes often; a fresh yt-dlp on every start avoids most "it stopped working" moments.
& $python -m pip install --quiet --upgrade "yt-dlp[default]" *> $null

$run = { & $python -m uvicorn app:app --host 127.0.0.1 --port 8765 }
if ($Log) {
    $logDir = Join-Path $server 'logs'
    New-Item -ItemType Directory -Force $logDir | Out-Null
    & $run *>> (Join-Path $logDir 'server.log')
} else {
    & $run
}
