@echo off
rem Double-click to run restart.ps1 (bypasses Windows' "running scripts is disabled" block for this script only).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart.ps1" %*
pause
