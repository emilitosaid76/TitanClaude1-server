# Manual de orquestacion — Titan Agent

Guia para un agente que va a **dirigir** a Titan Agent: delegarle el trabajo pesado
y quedarse con el criterio y la verificacion.

Todo lo que sigue esta medido, no supuesto. Las cifras vienen del banco de pruebas
del repo (`bench/`) y de comprobaciones contra el hardware real.

---

## 1. Que es y donde esta

Titan Agent es un servidor HTTP que envuelve a Ollama y le anade tres capacidades
que Ollama no tiene: ejecutar comandos por SSH, buscar en internet y leer paginas web.

```
Tu (agente orquestador)
    │  HTTP POST /api/agent
    ▼
Titan Agent — http://10.0.0.7:3000
    │  HTTP → 127.0.0.1:11434
    ▼
Ollama → gemma4:12b sobre una RTX 3060 de 12 GB
```

No hay integracion especial ni SDK. Es HTTP normal: cualquier cliente capaz de
hacer un POST y leer un stream sirve. La interfaz web y la app Android son
exactamente eso, otros dos clientes del mismo servidor.

**Punto unico de fallo:** si 10.0.0.7 esta apagado, no hay orquestacion posible.
Empieza siempre comprobando que responde.

---

## 2. Primer contacto

```bash
cd <repo>/ollama-workstation
node titan-cli.js health
```

Salida esperada:

```
1. servidor Titan  : OK (4 modelos)
2. Ollama vivo     : OK (v0.32.9)
3. inferencia      : OK (71 tokens con gemma4:12b)
```

Si falla el punto 1, el servidor esta caido → ver seccion 8.
Si falla el 2 o el 3, el servidor vive pero Ollama no responde.

---

## 3. La API

Base: `http://10.0.0.7:3000` (configurable con `TITAN_HOST`).

| Endpoint | Metodo | Para que |
|---|---|---|
| `/api/models` | GET | Modelos disponibles. El preferido viene **primero** |
| `/api/gpu` | GET | Nombre, carga, VRAM usada/total, temperatura |
| `/api/agent` | POST | **El importante**: chat agentico con herramientas (stream SSE) |
| `/api/exec` | POST | Un comando SSH suelto, sin modelo de por medio |
| `/api/search` | POST | Buscar en internet (DuckDuckGo) |
| `/api/web` | POST | Leer una pagina o un repo |
| `/api/ollama/restart` | POST | Reiniciar Ollama |

### `/api/agent` — el que usaras casi siempre

```javascript
const resp = await fetch('http://10.0.0.7:3000/api/agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gemma4:12b',
    messages: [{ role: 'user', content: 'tu tarea' }],
    sshConnections: [],   // solo si la tarea necesita SSH
  }),
});
```

### `/api/web` tiene trato especial para GitHub

- `github.com/owner/repo` → devuelve la **estructura real de archivos** via API
- `github.com/owner/repo/blob/rama/archivo` → devuelve el **texto plano** del archivo

No pidas la pagina renderizada de GitHub: es casi toda interfaz. Esta diferencia
fue una de las mejoras que mas subio la precision.

---

## 4. El protocolo SSE

La respuesta de `/api/agent` es un stream de lineas `data: {...}`.

| `type` | Contenido | Cuidado |
|---|---|---|
| `text` | Respuesta visible, token a token | |
| `thinking` | Razonamiento del modelo | **No lo ignores** — ver abajo |
| `exec_start` | Empieza una herramienta (`host`, `command`) | |
| `exec_result` | Resultado (`host`, `command`, `output`) | |
| `exec_error` | Fallo (`host`, `error`) | |
| `context` | `promptTokens`, `evalTokens` | Util para vigilar el contexto |
| `error` | Error del servidor | |

### El campo `thinking`

`gemma4` es un modelo de razonamiento: separa su analisis en `thinking` y su
respuesta en `content`. Un cliente que solo lea `content` vera **turnos vacios**
cuando el modelo gaste su presupuesto razonando, sin ningun error que lo explique.

Ese bug costo horas de diagnostico. Si escribes un cliente nuevo, maneja `thinking`
desde el principio, aunque solo sea para mostrarlo atenuado.

### Lectura minima del stream

```javascript
const rd = resp.body.getReader();
const dec = new TextDecoder();
let buf = '', texto = '';
while (true) {
  const { done, value } = await rd.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const l of lines) {
    if (!l.startsWith('data: ')) continue;
    const raw = l.slice(6);
    if (raw === '[DONE]') continue;
    try {
      const p = JSON.parse(raw);
      if (p.type === 'text') texto += p.content;
      else if (p.type === 'exec_start') console.log('[tool]', p.command);
    } catch {}
  }
}
```

---

## 5. Como decide el modelo usar herramientas

El modelo no llama funciones: **escribe bloques en su respuesta**, el servidor los
detecta, los ejecuta y le devuelve el resultado como un mensaje nuevo. Repite hasta
que responde sin bloques, con un tope de 10 iteraciones.

````
```search
query: lo que busca
```

```web
url: https://...
```

```exec
host: 10.0.0.7
command: uptime
```
````

Consecuencia practica: **el texto que devuelve incluye esos bloques en crudo**.
Si vas a mostrarselo a alguien, filtralos:

```javascript
texto.replace(/```(?:exec|search|web)[\s\S]*?```/g, '').trim()
```

---

## 6. Reparto de trabajo

Medido el 2026-08-12 con `bench/bench.js`, 3 repeticiones por tarea:

| Tarea | Media | Rango |
|---|---|---|
| Documentacion + codigo | 100% | 100-100% |
| Investigacion en repos | 100% | 100-100% |
| Diagnostico por SSH | 95% | 86-100% |

**Delegale a Titan:** busquedas web, leer paginas y repositorios, comandos SSH,
generar codigo a partir de documentacion, resumenes, trabajo repetitivo o en lote.

**Quedate tu:** decidir que pedir, verificar lo que devuelve, detectar errores,
editar archivos, y cualquier cosa donde equivocarse salga caro.

**No delegues el criterio.** Durante el desarrollo, aceptar resultados sin
comprobarlos llevo a conclusiones erroneas varias veces. En tareas de datos
verificables Titan acerto el 100% de lo que se comprobo a mano; el riesgo no esta
en que invente datos que obtuvo de una herramienta, sino en lo que deduce a partir
de ellos.

---

## 7. Fallos conocidos y como evitarlos

**Mide varias veces, mira el rango.** Un fallo intermitente aparecia en 1 de cada 3
corridas. Medido una sola vez, parecia resuelto. La media engana: una tarea con
media 80% y rango 40-100% es peor que una con media 75% y rango 73-77%.

**Verifica que el codigo desplegado esta activo antes de medir.** Hubo una tanda
entera de conclusiones invalidas por medir contra un proceso viejo. Comprobacion
rapida:

```bash
curl -s http://10.0.0.7:3000/api/models | head -c 200
```

**Cuidado con la logica duplicada.** El bucle del agente llego a tener su propia
copia del codigo de `web` y `search`, asi que arreglar los endpoints no cambiaba
nada para el modelo. Si tocas una capacidad, comprueba que solo existe en un sitio.

**Las reglas de prompt son probabilisticas.** Los arreglos en el servidor dieron
mejoras deterministas (varianza a cero). Las reglas anadidas al prompt del sistema
se cumplen 2 de cada 3 veces. Si necesitas una garantia, ponla en el codigo.

**SSH necesita contrasena explicita.** El servidor corre como SYSTEM, asi que no
encuentra llaves en el perfil del usuario. Pasa la credencial por entorno, nunca
en un archivo: el repo es publico.

```bash
TITAN_WS_PASS=xxxxx node titan-cli.js agent "tarea que use SSH"
```

**Los modelos tardan.** Entre 87 y 148 segundos por tarea agentica. Si escribes un
cliente, pon el timeout de lectura en 300s: cargar un modelo en VRAM puede anadir
un minuto antes del primer token.

---

## 8. Operar el servidor

Corre como tarea programada `TitanAgent` bajo SYSTEM: arranca al encender, sobrevive
al cierre de la terminal y un vigilante lo revive cada 5 minutos si muere.

```bash
# Desplegar un cambio: copiar y matar el proceso, el vigilante lo levanta
scp server.js GEODRONE@10.0.0.7:C:/TitanAgent/server.js
ssh GEODRONE@10.0.0.7 "powershell -Command \"Stop-Process -Name node -Force\""

# Sin esperar al vigilante
ssh GEODRONE@10.0.0.7 "powershell -Command \"Start-ScheduledTask -TaskName TitanAgent\""
```

Detalles en `deploy/README.md`.

---

## 9. Verificar que no rompiste nada

```bash
WS_PASS=xxxxx node bench/bench.js gemma4:12b 3
```

Puntua contra hechos verificados a mano e incluye comprobaciones **negativas** que
vigilan errores que ya ocurrieron. Correlo antes y despues de cualquier cambio en
`server.js` o en el prompt del sistema. Detalles en `bench/README.md`.

---

## 10. Eleccion de modelo

Por defecto **`gemma4:12b`** (7.6 GB): entra entero en la GPU, `ollama ps` reporta
`100% GPU`.

`gemma4:26b` pesa 17 GB en una tarjeta de 12: desborda unos 5 GB a RAM y va mas
lento. En comparacion directa **no** demostro ser mejor — inventaba un nombre de
entorno de compilacion en 2 de cada 3 corridas, cosa que el 12b no hizo ninguna.

La mayor parte de la precision vino de arreglar el servidor, no del tamano del
modelo. Antes de asumir que un modelo mayor rendira mas, pasalo por el banco.
