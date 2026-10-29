@echo off
rem GrowthApex EMS - create the Windows scheduled tasks for the WhatsApp/email automation.
rem Right-click -> "Run as administrator".
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0setup-tasks.ps1"
echo.
pause
