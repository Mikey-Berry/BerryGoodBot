@echo off
rem Double-click to run install-autostart.ps1 (bypasses Windows' "running scripts is disabled" block for this script only).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" %*
pause
