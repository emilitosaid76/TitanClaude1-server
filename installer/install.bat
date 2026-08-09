@echo off
title TITAN AGENT - Instalador
color 0E

echo.
echo  ============================================
echo          TITAN AGENT - INSTALADOR
echo     IA Local + SSH Remoto para tu red
echo  ============================================
echo.

:: Check admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Se requieren permisos de administrador.
    echo  [!] Click derecho - Ejecutar como administrador
    echo.
    pause
    exit /b 1
)

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [X] Node.js no esta instalado.
    echo  [i] Descargalo de https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER% detectado

:: Set install directory
set INSTALL_DIR=C:\TitanAgent
echo  [i] Directorio de instalacion: %INSTALL_DIR%
echo.

:: Create directory
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\public" mkdir "%INSTALL_DIR%\public"

:: Copy files
echo  [1/5] Copiando archivos...
copy /Y "%~dp0server.js" "%INSTALL_DIR%\server.js" >nul
copy /Y "%~dp0package.json" "%INSTALL_DIR%\package.json" >nul
xcopy /Y /E /Q "%~dp0public\*" "%INSTALL_DIR%\public\" >nul 2>&1
copy /Y "%~dp0titan-agent.bat" "%INSTALL_DIR%\titan-agent.bat" >nul
copy /Y "%~dp0titan-service.vbs" "%INSTALL_DIR%\titan-service.vbs" >nul
copy /Y "%~dp0titan-stop.bat" "%INSTALL_DIR%\titan-stop.bat" >nul
echo  [OK] Archivos copiados

:: Install dependencies
echo  [2/5] Instalando dependencias (npm install)...
cd /d "%INSTALL_DIR%"
call npm install --production >nul 2>&1
if %errorlevel% neq 0 (
    echo  [X] Error instalando dependencias
    pause
    exit /b 1
)
echo  [OK] Dependencias instaladas

:: Create desktop shortcut
echo  [3/5] Creando acceso directo en escritorio...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\TITAN AGENT.lnk'); $sc.TargetPath='C:\TitanAgent\titan-agent.bat'; $sc.WorkingDirectory='C:\TitanAgent'; $sc.IconLocation='shell32.dll,21'; $sc.Description='TITAN AGENT'; $sc.Save()"
echo  [OK] Acceso directo creado

:: Ask about autostart
echo.
set /p AUTOSTART="  Iniciar TITAN AGENT con Windows? (S/N): "
if /i "%AUTOSTART%"=="S" (
    echo  [4/5] Configurando inicio automatico...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $startup=$ws.SpecialFolders('Startup'); $sc=$ws.CreateShortcut($startup+'\TITAN AGENT.lnk'); $sc.TargetPath='wscript.exe'; $sc.Arguments='C:\TitanAgent\titan-service.vbs'; $sc.WorkingDirectory='C:\TitanAgent'; $sc.Save()"
    echo  [OK] Inicio automatico configurado
) else (
    echo  [4/5] Inicio automatico omitido
)

:: Configure firewall
echo  [5/5] Configurando firewall...
netsh advfirewall firewall delete rule name="TITAN AGENT" >nul 2>&1
netsh advfirewall firewall add rule name="TITAN AGENT" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo  [OK] Puerto 3000 abierto en firewall

echo.
echo  ============================================
echo       INSTALACION COMPLETADA
echo  ============================================
echo.
echo  Accesos directos creados:
echo    - Escritorio: "TITAN AGENT" (click para abrir menu)
echo.
echo  Direcciones de acceso:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do echo    - http://%%b:3000
)
echo.
set /p START_NOW="  Iniciar TITAN AGENT ahora? (S/N): "
if /i "%START_NOW%"=="S" (
    start "" "%INSTALL_DIR%\titan-agent.bat"
)
echo.
pause
