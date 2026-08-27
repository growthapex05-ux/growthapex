@echo off
cd /d "%~dp0"
node checkin-listener.js >> listener_log.txt 2>&1
