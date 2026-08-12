# Registra Titan Agent como tarea programada en un servidor Windows.
#
# Uso (en el servidor, PowerShell como administrador):
#   1. Copiar server.js, public\ y deploy\run-titan.cmd a C:\TitanAgent\
#   2. .\setup-service.ps1
#
# Resultado: el servidor arranca al encender el equipo (sin iniciar sesion),
# sobrevive al cierre de la terminal y se revive solo si el proceso muere.
# Es re-ejecutable: si la tarea ya existe, la reemplaza.

$ErrorActionPreference = 'Stop'
$TASK = 'TitanAgent'

if (Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TASK -Confirm:$false
  Write-Output 'tarea anterior eliminada'
}

$action = New-ScheduledTaskAction -Execute 'C:\TitanAgent\run-titan.cmd' -WorkingDirectory 'C:\TitanAgent'

# Al arrancar el equipo...
$tArranque = New-ScheduledTaskTrigger -AtStartup

# ...y un vigilante cada 5 min: si el proceso murio, vuelve a levantarlo.
# Con MultipleInstances=IgnoreNew, si ya esta corriendo la instancia nueva se descarta.
# Nota: TimeSpan::MaxValue lo rechaza Task Scheduler ("fuera de intervalo"); usar un plazo largo valido.
$tVigilante = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)

# SYSTEM para que no dependa de que haya una sesion iniciada.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TASK -Action $action -Trigger $tArranque, $tVigilante `
  -Principal $principal -Settings $settings -Description 'Titan Agent - servidor Ollama/SSH' | Out-Null

Write-Output 'tarea TitanAgent registrada'

# Liberar el puerto 3000 si habia un node lanzado a mano
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Start-ScheduledTask -TaskName $TASK
Start-Sleep -Seconds 6

Write-Output ('estado tarea  = ' + (Get-ScheduledTask -TaskName $TASK).State)
Write-Output ('procesos node = ' + (Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count)
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/models' -TimeoutSec 10
  Write-Output ('servidor responde, modelos = ' + $r.models.Count)
} catch {
  Write-Output ('servidor NO responde: ' + $_.Exception.Message)
}
