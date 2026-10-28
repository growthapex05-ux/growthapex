@echo off
rem GrowthApex EMS - send WhatsApp reports manually (double-click this file)
cd /d "%~dp0"
chcp 65001 > nul
:menu
echo.
echo ==========================================
echo    GrowthApex EMS - WhatsApp Report Bhejo
echo ==========================================
echo   1. Aaj ki DAILY report (shaam wali)
echo   2. Aaj ki MORNING report
echo   3. Chhooti hui reports bhejo (catch-up)
echo   4. Kisi date ki daily report
echo   5. Weekly report
echo   6. Monthly report
echo   7. Status dekho (internet / WhatsApp / queue)
echo   8. Preview (bina bheje dekho - aaj ki daily)
echo   0. Band karo
echo ------------------------------------------
set /p choice=Number chuno: 
if "%choice%"=="1" node run.js --type=daily --force
if "%choice%"=="2" node run.js --type=login --force
if "%choice%"=="3" node run.js --catch-up
if "%choice%"=="4" (
  set /p rdate=Date likho YYYY-MM-DD: 
  call node run.js --type=daily --date=%%rdate%% --force
)
if "%choice%"=="5" node run.js --type=weekly --force
if "%choice%"=="6" node run.js --type=monthly --force
if "%choice%"=="7" node run.js --status
if "%choice%"=="8" node run.js --type=daily --dry-run
if "%choice%"=="0" exit /b
goto menu
