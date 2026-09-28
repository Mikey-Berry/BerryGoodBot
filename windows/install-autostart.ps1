# Registers a hidden scheduled task that starts BerryTunes whenever you log in.
# Remove it again with:  powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1 -Remove
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'BerryTunes'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host 'Auto-start removed.'
    return
}

$start = Join-Path $PSScriptRoot 'start.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$start`" -Log"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host 'BerryTunes will now start automatically when you log in (and is starting now).'
