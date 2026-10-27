@echo off
cd /d "%~dp0"
node run.js --type=login >> reports_log.txt 2>&1
