@echo off
rem Keeps the real-time listener running; restarts it 30s after any crash
cd /d "%~dp0"
:loop
echo [%date% %time%] Starting check-in listener >> listener_log.txt
node checkin-listener.js >> listener_log.txt 2>&1
echo [%date% %time%] Listener stopped, restarting in 30s >> listener_log.txt
timeout /t 30 /nobreak > nul
goto loop
