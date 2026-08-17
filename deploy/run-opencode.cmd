@echo off
REM Lanzador del servidor headless de OpenCode. Lo invoca la tarea programada "OpenCodeServe".
REM Debe estar en C:\OpenCodeServe\run-opencode.cmd en el servidor.
cd /d C:\OpenCodeServe
if exist env.cmd call env.cmd
echo [%DATE% %TIME%] arrancando OpenCode serve >> opencode-serve.log
"C:\Users\GEODRONE\AppData\Roaming\npm\opencode.cmd" serve --hostname 0.0.0.0 --port 4096 --print-logs --log-level DEBUG >> opencode-serve.log 2>&1
echo [%DATE% %TIME%] OpenCode serve termino con codigo %ERRORLEVEL% >> opencode-serve.log
