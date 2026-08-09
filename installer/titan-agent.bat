@echo off
title TITAN AGENT
color 0E
cd /d "C:\TitanAgent"

:MENU
cls
echo.
echo  ============================================
echo       TITAN AGENT - Panel de Control
echo  ============================================
echo.

:: Check if server is running
set RUNNING=NO
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do set RUNNING=SI

if "%RUNNING%"=="SI" (
    echo   Estado: [ACTIVO]
) else (
    echo   Estado: [DETENIDO]
)

echo.
echo   Direcciones de acceso:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do echo     http://%%b:3000
)
echo.
echo  ============================================
echo.
echo   [1] Iniciar servidor
echo   [2] Reiniciar servidor
echo   [3] Detener servidor
echo   [4] Iniciar en segundo plano (sin ventana)
echo   [5] Ver logs del servidor
echo.
echo   [A] Activar inicio con Windows
echo   [D] Desactivar inicio con Windows
echo.
echo   [0] Salir
echo.
echo  ============================================
echo.
set /p OPT="  Selecciona una opcion: "

if "%OPT%"=="1" goto START
if "%OPT%"=="2" goto RESTART
if "%OPT%"=="3" goto STOP
if "%OPT%"=="4" goto BACKGROUND
if "%OPT%"=="5" goto LOGS
if /i "%OPT%"=="A" goto AUTOSTART_ON
if /i "%OPT%"=="D" goto AUTOSTART_OFF
if "%OPT%"=="0" goto EXIT
goto MENU

:START
call :KILL_SERVER
echo.
echo  [i] Iniciando TITAN AGENT...
start "TITAN-SERVER" /MIN cmd /c "cd /d C:\TitanAgent && node server.js > C:\TitanAgent\server.log 2>&1"
timeout /t 3 /nobreak >nul
echo  [OK] Servidor iniciado
echo.
pause
goto MENU

:RESTART
call :KILL_SERVER
echo.
echo  [i] Reiniciando TITAN AGENT...
start "TITAN-SERVER" /MIN cmd /c "cd /d C:\TitanAgent && node server.js > C:\TitanAgent\server.log 2>&1"
timeout /t 3 /nobreak >nul
echo  [OK] Servidor reiniciado
echo.
pause
goto MENU

:STOP
call :KILL_SERVER
echo.
echo  [OK] Servidor detenido
echo.
pause
goto MENU

:BACKGROUND
call :KILL_SERVER
echo.
echo  [i] Iniciando en segundo plano...
start "" wscript.exe "C:\TitanAgent\titan-service.vbs"
timeout /t 3 /nobreak >nul
echo  [OK] Servidor corriendo en segundo plano
echo  [i] Para detenerlo, usa la opcion 3 del menu
echo.
pause
goto MENU

:LOGS
cls
echo.
echo  === LOGS DE TITAN AGENT ===
echo.
if exist "C:\TitanAgent\server.log" (
    type "C:\TitanAgent\server.log"
) else (
    echo  No hay logs disponibles
)
echo.
pause
goto MENU

:AUTOSTART_ON
echo.
echo  [i] Configurando inicio automatico...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $startup=$ws.SpecialFolders('Startup'); $sc=$ws.CreateShortcut($startup+'\TITAN AGENT.lnk'); $sc.TargetPath='wscript.exe'; $sc.Arguments='C:\TitanAgent\titan-service.vbs'; $sc.WorkingDirectory='C:\TitanAgent'; $sc.Save()"
echo  [OK] TITAN AGENT iniciara con Windows
echo.
pause
goto MENU

:AUTOSTART_OFF
echo.
echo  [i] Desactivando inicio automatico...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TITAN AGENT.lnk" >nul 2>&1
echo  [OK] Inicio automatico desactivado
echo.
pause
goto MENU

:EXIT
exit /b 0

:KILL_SERVER
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
exit /b 0
