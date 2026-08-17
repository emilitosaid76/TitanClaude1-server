# Despliegue de Titan Agent

## Servidor Windows (10.0.0.7)

El servidor vive en `C:\TitanAgent\` y corre como tarea programada `TitanAgent`,
no como proceso de terminal. Arranca al encender el equipo sin necesidad de
iniciar sesion, y un vigilante lo revive si el proceso muere.

### Instalacion inicial

```powershell
# 1. Copiar server.js, public\ y deploy\run-titan.cmd a C:\TitanAgent\
# 2. En PowerShell como administrador:
.\setup-service.ps1
```

### Desplegar cambios

Copiar el archivo y matar el proceso: el vigilante lo levanta con el codigo nuevo
en menos de 5 minutos.

```bash
scp server.js GEODRONE@10.0.0.7:C:/TitanAgent/server.js
ssh GEODRONE@10.0.0.7 "powershell -Command \"Stop-Process -Name node -Force\""
```

Para que tome efecto de inmediato en lugar de esperar al vigilante:

```bash
ssh GEODRONE@10.0.0.7 "powershell -Command \"Start-ScheduledTask -TaskName TitanAgent\""
```

### Verificar

Conviene comprobar que el codigo nuevo quedo activo **antes** de medir nada:
una medicion contra el proceso viejo da resultados enganosos.

```bash
curl http://10.0.0.7:3000/api/models
```

### Diagnostico

- Log del servidor: `C:\TitanAgent\titan-agent.log` (crece sin rotacion)
- Estado de la tarea: `Get-ScheduledTask -TaskName TitanAgent`
- Procesos: `Get-Process node`

## Notas

- La ventana de recuperacion es de hasta 5 minutos. Para acortarla, bajar
  `-RepetitionInterval` en `setup-service.ps1`.
- La tarea corre como SYSTEM. Por eso el agente no encuentra llaves SSH en el
  perfil del usuario: para `exec` por SSH hay que pasar contrasena explicita.
