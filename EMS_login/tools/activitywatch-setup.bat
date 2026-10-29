@echo off
rem GrowthApex EMS - connect ActivityWatch to the EMS dashboard (run once, after installing ActivityWatch).
rem Lets https://growthapex.in read the app/website usage summary from ActivityWatch on this laptop.
chcp 65001 > nul

set "AWCFG=%LOCALAPPDATA%\activitywatch\activitywatch"

rem aw-server (default server in ActivityWatch)
mkdir "%AWCFG%\aw-server" 2>nul
> "%AWCFG%\aw-server\aw-server.toml" (
  echo [server]
  echo host = "localhost"
  echo port = "5600"
  echo storage = "peewee"
  echo cors_origins = "https://growthapex.in,https://www.growthapex.in"
)

rem aw-server-rust (used if enabled in ActivityWatch)
mkdir "%AWCFG%\aw-server-rust" 2>nul
> "%AWCFG%\aw-server-rust\config.toml" (
  echo cors = ["https://growthapex.in", "https://www.growthapex.in"]
)

rem Restart ActivityWatch so it picks up the setting
taskkill /IM aw-qt.exe /F > nul 2>&1
taskkill /IM aw-server.exe /F > nul 2>&1
taskkill /IM aw-server-rust.exe /F > nul 2>&1
timeout /t 3 /nobreak > nul
if exist "%LOCALAPPDATA%\Programs\ActivityWatch\aw-qt.exe" (
  start "" "%LOCALAPPDATA%\Programs\ActivityWatch\aw-qt.exe"
) else if exist "%ProgramFiles%\ActivityWatch\aw-qt.exe" (
  start "" "%ProgramFiles%\ActivityWatch\aw-qt.exe"
) else (
  echo ActivityWatch not found - please install it first: https://activitywatch.net/downloads/
  pause
  exit /b 1
)

echo.
echo Done! ActivityWatch is connected to GrowthApex EMS.
echo Open the EMS dashboard - on the Attendance page it should say "Screen activity: connected".
echo If Chrome asks to allow access to devices on your local network, click Allow.
pause
