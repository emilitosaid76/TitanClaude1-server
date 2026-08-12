# Banco de pruebas de Titan Agent

Mide al agente contra hechos verificados a mano, no contra criterio subjetivo.
Cada tarea se corre varias veces para exponer la **variacion entre corridas**,
que es donde se esconden los fallos intermitentes.

## Uso

```bash
# Todas las tareas, 3 repeticiones, con la de SSH incluida
WS_PASS=tu_clave node bench/bench.js gemma4:12b 3

# Sin WS_PASS la tarea de SSH se omite y el resto corre igual
node bench/bench.js gemma4:26b 3
```

## Que mide

| Tarea | Ejercita |
|---|---|
| `hardware` | `exec` por SSH encadenado, lectura de datos reales y calculo |
| `firmware` | `search` + `web`, arbol real de GitHub, no inventar configuracion |
| `fastapi` | `search` + `web` sobre documentacion, generacion de codigo |

## Comprobaciones negativas

Son las mas valiosas: vigilan errores **que ya ocurrieron** en este proyecto,
para que una regresion se detecte sola en vez de aparecer por casualidad.

- **no inventa el entorno `BIQU_TFT35_V1.2`** — el modelo lo deducia del nombre
  de un `.bin` en vez de leer `platformio.ini`. Un nombre de entorno inventado
  hace fallar el build.
- **no duplica la respuesta** — el modelo emitia un bloque de herramienta y
  seguia respondiendo antes de tener el resultado; el usuario veia dos
  respuestas distintas a la misma pregunta.
- **no afirma que el 26b cabe en VRAM** — pesa 17 GB en una tarjeta de 12 GB.
- **contrasta con la VRAM libre actual** — reportaba "647 MB libres" y concluia
  que un modelo de 9 GB cabia, sin ver la contradiccion.

## Interpretacion

Mirar el **rango**, no solo la media. Una tarea con media 80% y rango 60-100%
es menos fiable que una con media 75% y rango 73-77%: la primera falla de forma
intermitente y una sola corrida no lo revela.

Precedente concreto: el modelo inventaba el nombre del entorno en dos de cada
tres corridas de la misma tarea. Medido una sola vez, parecia resuelto.
