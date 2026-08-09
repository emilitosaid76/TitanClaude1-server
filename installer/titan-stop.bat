@echo off
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq TITAN-SERVER" /F >nul 2>&1
echo TITAN AGENT detenido.
