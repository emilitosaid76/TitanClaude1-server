# Registra el servidor headless de OpenCode como tarea programada en un servidor Windows.
#
# Uso (en el servidor, PowerShell como administrador):
#   1. Copiar run-opencode.cmd y env.cmd (con OPENCODE_SERVER_USERNAME/PASSWORD) a C:\OpenCodeServe\
#   2. .\setup-opencode-service.ps1
#
# Resultado: arranca al encender el equipo (sin iniciar sesion), sobrevive al
# cierre de la terminal y se revive solo si el proceso muere. Es re-ejecutable.

$ErrorActionPreference = 'Stop'
$TASK = 'OpenCodeServe'

if (Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TASK -Confirm:$false
  Write-Output 'tarea anterior eliminada'
}

$action = New-ScheduledTaskAction -Execute 'C:\OpenCodeServe\run-opencode.cmd' -WorkingDirectory 'C:\OpenCodeServe'

$tArranque = New-ScheduledTaskTrigger -AtStartup

$tVigilante = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)

# SYSTEM (mismo patron que TitanAgent/OllamaProxy): no depende de sesion
# iniciada, y como run-opencode.cmd usa la ruta absoluta del binario
# instalado en el perfil de GEODRONE, no hace falta correr como ese usuario.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TASK -Action $action -Trigger $tArranque, $tVigilante `
  -Principal $principal -Settings $settings -Description 'Servidor headless de OpenCode' | Out-Null

Write-Output 'tarea OpenCodeServe registrada'

Start-ScheduledTask -TaskName $TASK
Start-Sleep -Seconds 5

Write-Output ('estado tarea = ' + (Get-ScheduledTask -TaskName $TASK).State)
try {
  Invoke-WebRequest -Uri 'http://127.0.0.1:4096/doc' -TimeoutSec 10 -UseBasicParsing | Out-Null
  Write-Output 'servidor responde en :4096'
} catch {
  Write-Output ('servidor NO responde: ' + $_.Exception.Message)
}
