@echo off
rem GrowthApex EMS - email setup (double-click this file)
cd /d "%~dp0"
chcp 65001 > nul
echo ==========================================
echo    GrowthApex EMS - Email Setup
echo ==========================================
node setup-email.js
echo.
pause
