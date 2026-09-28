# Restarts the BerryTunes server, e.g. after copying in updated files.
$ErrorActionPreference = 'Continue'
$taskName = 'BerryTunes'

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
# Stopping the task doesn't always stop the Python process it launched, so end it directly.
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object { $_.CommandLine -like '*uvicorn*app:app*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName $taskName
    Write-Host 'BerryTunes is restarting. Give it up to a minute (it checks for a yt-dlp update first).'
} else {
    Write-Host 'Server stopped. Auto-start is not installed, so start it with start.cmd or install-autostart.cmd.'
}
