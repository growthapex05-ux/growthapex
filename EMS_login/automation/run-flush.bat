@echo off
cd /d "%~dp0"
node run.js --flush >> reports_log.txt 2>&1
