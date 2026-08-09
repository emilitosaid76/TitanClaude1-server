@echo off
title Empaquetar TITAN AGENT
echo.
echo  Empaquetando TITAN AGENT para distribucion...
echo.

set OUT=%~dp0TitanAgent-Installer
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"
mkdir "%OUT%\public"

copy /Y "%~dp0..\server.js" "%OUT%\server.js" >nul
copy /Y "%~dp0..\package.json" "%OUT%\package.json" >nul
xcopy /Y /E /Q "%~dp0..\public\*" "%OUT%\public\" >nul 2>&1
copy /Y "%~dp0install.bat" "%OUT%\install.bat" >nul
copy /Y "%~dp0titan-agent.bat" "%OUT%\titan-agent.bat" >nul
copy /Y "%~dp0titan-service.vbs" "%OUT%\titan-service.vbs" >nul
copy /Y "%~dp0titan-stop.bat" "%OUT%\titan-stop.bat" >nul

echo  [OK] Carpeta lista en: %OUT%
echo.
echo  Copia esta carpeta al PC de Ollama y ejecuta install.bat como administrador.
echo.
pause
