@echo off
rem Double-click to run setup.ps1 (bypasses Windows' "running scripts is disabled" block for this script only).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
pause
