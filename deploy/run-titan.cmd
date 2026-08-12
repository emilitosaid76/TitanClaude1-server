@echo off
REM Lanzador de Titan Agent. Lo invoca la tarea programada "TitanAgent".
REM Debe estar en C:\TitanAgent\run-titan.cmd en el servidor.
cd /d C:\TitanAgent
echo [%DATE% %TIME%] arrancando Titan Agent >> titan-agent.log
"C:\Program Files\nodejs\node.exe" server.js >> titan-agent.log 2>&1
echo [%DATE% %TIME%] Titan Agent termino con codigo %ERRORLEVEL% >> titan-agent.log
