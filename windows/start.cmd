@echo off
rem Double-click to run start.ps1 (bypasses Windows' "running scripts is disabled" block for this script only).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
