# GrowthApex EMS - (Re)create all Windows Task Scheduler jobs for the WhatsApp automation.
# Times are read from .env, so change them there and re-run:
#   powershell -ExecutionPolicy Bypass -File setup-tasks.ps1
#
# Every task uses "Run as soon as possible after a missed start", so if the PC was off,
# asleep or offline at the scheduled time the report still goes out later (the offline
# queue + Firestore "sent" markers stop duplicates).

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---- read .env ----
$envVars = @{}
$envFile = Join-Path $dir '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $envVars[$Matches[1]] = $Matches[2] }
    }
}
function Get-Setting($name, $default) {
    if ($envVars.ContainsKey($name) -and $envVars[$name]) { return $envVars[$name] }
    return $default
}

$dailyTime   = Get-Setting 'DAILY_REPORT_TIME'   '19:00'
$morningTime = Get-Setting 'MORNING_REPORT_TIME' '11:00'
$weeklyTime  = Get-Setting 'WEEKLY_REPORT_TIME'  '10:00'
$monthlyTime = Get-Setting 'MONTHLY_REPORT_TIME' '10:00'
$flushMins   = [int](Get-Setting 'FLUSH_INTERVAL_MINUTES' '15')

# ---- remove old / broken tasks ----
$old = @(
    'GrowthApex_Daily_Report', 'GrowthApex_Evening_Report', 'GrowthApex_Morning_Report',
    'GrowthApex_Weekly_Report', 'GrowthApex_Monthly_Report', 'GrowthApex_Realtime_Listener',
    'GrowthApex_EMS_DailyReport', 'GrowthApex_EMS_MorningReport', 'GrowthApex_EMS_WeeklyReport',
    'GrowthApex_EMS_MonthlyReport', 'GrowthApex_EMS_Flush', 'GrowthApex_EMS_Listener'
)
foreach ($name in $old) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "Removed old task: $name"
    }
}

# ---- helpers ----
function New-BatAction($bat) {
    $path = Join-Path $dir $bat
    # Path must be quoted - the folder name has spaces (that is what broke the old tasks)
    New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$path`"" -WorkingDirectory $dir
}

function New-Settings([TimeSpan]$limit) {
    New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew -ExecutionTimeLimit $limit `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
}

function Register-EmsTask($name, $bat, $trigger, [TimeSpan]$limit) {
    Register-ScheduledTask -TaskName $name -Action (New-BatAction $bat) -Trigger $trigger `
        -Settings (New-Settings $limit) -Description 'GrowthApex EMS WhatsApp automation' | Out-Null
    Write-Host "Created: $name"
}

$workDays = 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
$oneHour = New-TimeSpan -Hours 1

Register-EmsTask 'GrowthApex_EMS_DailyReport'   'run-daily.bat'   (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $workDays -At $dailyTime)   $oneHour
Register-EmsTask 'GrowthApex_EMS_MorningReport' 'run-morning.bat' (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $workDays -At $morningTime) $oneHour
Register-EmsTask 'GrowthApex_EMS_WeeklyReport'  'run-weekly.bat'  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At $weeklyTime)    $oneHour

# Monthly trigger is not available in New-ScheduledTaskTrigger -> create with schtasks, then apply settings
$monthlyAction = New-BatAction 'run-monthly.bat'
schtasks.exe /Create /F /TN 'GrowthApex_EMS_MonthlyReport' /SC MONTHLY /D 1 /ST $monthlyTime /TR 'cmd.exe' | Out-Null
Set-ScheduledTask -TaskName 'GrowthApex_EMS_MonthlyReport' -Action $monthlyAction -Settings (New-Settings $oneHour) | Out-Null
Write-Host 'Created: GrowthApex_EMS_MonthlyReport'

# Offline queue flush: every N minutes, re-send anything that could not be sent earlier
$flushTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $flushMins)
Register-EmsTask 'GrowthApex_EMS_Flush' 'run-flush.bat' $flushTrigger (New-TimeSpan -Minutes 30)

# Real-time check-in listener: starts at logon and runs forever (bat restarts it on crash)
Register-EmsTask 'GrowthApex_EMS_Listener' 'run-listener.bat' (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) ([TimeSpan]::Zero)

Write-Host ''
Write-Host "Daily: Mon-Sat $dailyTime | Morning: Mon-Sat $morningTime | Weekly: Mon $weeklyTime | Monthly: 1st $monthlyTime | Flush: every $flushMins min"
Write-Host 'Start the listener now with:  Start-ScheduledTask -TaskName GrowthApex_EMS_Listener'
