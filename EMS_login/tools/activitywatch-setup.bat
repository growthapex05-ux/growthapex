@echo off
rem GrowthApex EMS - connect ActivityWatch to the EMS dashboard (run once, after installing ActivityWatch).
rem Lets https://growthapex.in read the app/website usage summary from ActivityWatch on this laptop.
chcp 65001 > nul

rem aw-server (Python server): %LOCALAPPDATA%\activitywatch\activitywatch\aw-server\aw-server.toml
set "PYCFG=%LOCALAPPDATA%\activitywatch\activitywatch\aw-server"
mkdir "%PYCFG%" 2>nul
> "%PYCFG%\aw-server.toml" (
  echo [server]
  echo host = "localhost"
  echo port = "5600"
  echo storage = "peewee"
  echo cors_origins = "https://growthapex.in,https://www.growthapex.in"
)

rem aw-server-rust: %APPDATA%\activitywatch\aw-server-rust\config.toml (Roaming), older builds used Local
for %%D in ("%APPDATA%\activitywatch\aw-server-rust" "%LOCALAPPDATA%\activitywatch\aw-server-rust" "%LOCALAPPDATA%\activitywatch\activitywatch\aw-server-rust") do (
  mkdir "%%~D" 2>nul
  > "%%~D\config.toml" (
    echo cors = ["https://growthapex.in", "https://www.growthapex.in"]
  )
)

rem Restart ActivityWatch so it picks up the setting
echo Restarting ActivityWatch...
taskkill /IM aw-qt.exe /F > nul 2>&1
taskkill /IM aw-server.exe /F > nul 2>&1
taskkill /IM aw-server-rust.exe /F > nul 2>&1
taskkill /IM aw-watcher-window.exe /F > nul 2>&1
taskkill /IM aw-watcher-afk.exe /F > nul 2>&1
timeout /t 3 /nobreak > nul
if exist "%LOCALAPPDATA%\Programs\ActivityWatch\aw-qt.exe" (
  start "" "%LOCALAPPDATA%\Programs\ActivityWatch\aw-qt.exe"
) else if exist "%ProgramFiles%\ActivityWatch\aw-qt.exe" (
  start "" "%ProgramFiles%\ActivityWatch\aw-qt.exe"
) else if exist "%ProgramFiles(x86)%\ActivityWatch\aw-qt.exe" (
  start "" "%ProgramFiles(x86)%\ActivityWatch\aw-qt.exe"
) else (
  echo.
  echo ActivityWatch not found - please install it first: https://activitywatch.net/downloads/
  pause
  exit /b 1
)

rem Check: does ActivityWatch now allow growthapex.in? (waits up to ~40 s for it to start)
echo Checking the connection...
for /l %%i in (1,1,20) do (
  curl -s -i -H "Origin: https://growthapex.in" http://localhost:5600/api/0/info 2>nul | findstr /i "Access-Control-Allow-Origin" > nul && goto ok
  timeout /t 2 /nobreak > nul
)
echo.
echo NOT CONNECTED YET - ActivityWatch did not accept growthapex.in.
echo Please close ActivityWatch completely (right-click its icon near the clock - Quit), open it again,
echo and run this file once more. If it still fails, send a screenshot of this window to the admin.
pause
exit /b 1

:ok
echo.
echo OK - ActivityWatch is connected to GrowthApex EMS.
echo Now open the EMS dashboard and press Ctrl+Shift+R - it should say "Screen activity: connected".
echo If Chrome asks to allow access to your local network / other apps on this device, click Allow.
pause
