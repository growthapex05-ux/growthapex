@echo off
cd /d "%~dp0"
node run.js --type=weekly >> reports_log.txt 2>&1
