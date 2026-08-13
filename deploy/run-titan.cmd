@echo off
REM Lanzador de Titan Agent. Lo invoca la tarea programada "TitanAgent".
REM Debe estar en C:\TitanAgent\run-titan.cmd en el servidor.
cd /d C:\TitanAgent
REM Claves y ajustes locales (MOONSHOT_API_KEY, NUM_CTX...). Fuera del repositorio:
REM se lee en cada arranque y sobrevive a los despliegues de server.js.
if exist env.cmd call env.cmd
echo [%DATE% %TIME%] arrancando Titan Agent >> titan-agent.log
"C:\Program Files\nodejs\node.exe" server.js >> titan-agent.log 2>&1
echo [%DATE% %TIME%] Titan Agent termino con codigo %ERRORLEVEL% >> titan-agent.log
