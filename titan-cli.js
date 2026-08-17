#!/usr/bin/env node
const TITAN_HOST = process.env.TITAN_HOST || 'http://10.0.0.21:3001';
// Sin TITAN_MODEL se pregunta al servidor cual prefiere, en vez de fijar uno aqui:
// si la GPU esta fuera, un nombre local cableado en el cliente falla siempre.
const TITAN_MODEL = process.env.TITAN_MODEL || '';

// El servidor exige sesion desde que se agrego el panel de usuarios (login,
// roles administrador/usuario-l). El CLI se autentica una vez al arrancar y
// reutiliza la cookie de sesion en todas las llamadas siguientes.
const TITAN_USER = process.env.TITAN_USER || 'admin';
const TITAN_PASSWORD = process.env.TITAN_PASSWORD || '';
let sessionCookie = '';

async function ensureLogin() {
  if (sessionCookie) return;
  if (!TITAN_PASSWORD) {
    console.error('[CLI] Falta TITAN_PASSWORD. Ejemplo:\n' +
                  '  TITAN_PASSWORD=xxxxx node titan-cli.js <comando> ...');
    process.exit(1);
  }
  const resp = await fetch(`${TITAN_HOST}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TITAN_USER, password: TITAN_PASSWORD }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error(`[CLI] Login fallo (${resp.status}): ${body}`);
    process.exit(1);
  }
  const setCookie = resp.headers.get('set-cookie') || '';
  sessionCookie = setCookie.split(';')[0]; // "titan_session=<valor>"
  if (!sessionCookie) {
    console.error('[CLI] Login OK pero el servidor no devolvio cookie de sesion.');
    process.exit(1);
  }
}

/** fetch autenticado: agrega la cookie de sesion a cada llamada. */
async function authFetch(url, opts = {}) {
  await ensureLogin();
  const headers = { ...(opts.headers || {}), Cookie: sessionCookie };
  return fetch(url, { ...opts, headers });
}

/** Devuelve el modelo pedido, o el preferido del servidor si no se indico ninguno. */
async function resolveModel(model) {
  if (model) return model;
  try {
    const r = await authFetch(`${TITAN_HOST}/api/models`);
    const d = await r.json();
    return d.models?.[0]?.name || 'gemma4:12b';
  } catch {
    return 'gemma4:12b';
  }
}

const [,, command, ...args] = process.argv;

// El modelo es opcional. Se acepta `-m <modelo>` o un primer argumento con
// forma de modelo (nombre:tag); todo lo demas es el mensaje. Asi no hace falta
// pasar "" para usar el modelo por defecto: PowerShell descarta los argumentos
// vacios y la tarea acababa interpretandose como nombre de modelo.
function parseModelAndMessage(argv) {
  const rest = [...argv];
  let model = TITAN_MODEL;
  if (rest[0] === '-m' || rest[0] === '--model') {
    rest.shift();
    model = rest.shift() || TITAN_MODEL;
  } else if (rest[0] && (/^[\w.-]+:[\w.-]+$/.test(rest[0]) || /^(kimi|moonshot)[\w.-]*$/i.test(rest[0]))) {
    model = rest.shift();
  }
  return { model, message: rest.join(' ') };
}

// Lee el stream SSE de /api/agent.
//
// Cualquier evento con un `type` no contemplado se avisa por stderr en vez de
// descartarse: una generacion que consume miles de tokens y no imprime nada es
// un fallo mudo muy caro de diagnosticar. Con TITAN_DEBUG=1 se vuelca ademas
// cada evento crudo.
async function streamResponse(resp) {
  // Un error HTTP se veia igual que un modelo callado: ambos acababan en
  // "no produjo una respuesta visible". Distinguirlos evita perseguir al
  // modelo cuando lo que pasa es que el servidor esta caido.
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error(`[CLI] el servidor respondio ${resp.status} ${resp.statusText}. ` +
                  `Esto es un fallo de infraestructura, no del modelo.`);
    if (body) console.error(`[CLI] ${body.slice(0, 500)}`);
    process.exitCode = 3;
    return;
  }

  const debug = process.env.TITAN_DEBUG === '1';
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const showThinking = debug || process.env.TITAN_THINKING === '1';
  const seenTypes = new Set();
  let buf = '';
  let printed = 0;
  let thought = 0;
  let done = false;

  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') { done = true; break; }
      if (debug) console.error(`[RAW] ${data}`);

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        console.error(`[CLI] evento ilegible: ${err.message}`);
        continue;
      }

      seenTypes.add(parsed.type);
      switch (parsed.type) {
        case 'text':
          process.stdout.write(parsed.content);
          printed += (parsed.content || '').length;
          break;
        // Los modelos gemma4 razonan antes de responder. Ese razonamiento va
        // por su propio evento y no es la respuesta: ensucia la salida si se
        // imprime, pero perderlo en silencio deja sin explicacion los casos en
        // que el modelo agota el presupuesto pensando y no llega a contestar.
        case 'thinking':
          thought += (parsed.content || '').length;
          if (showThinking) process.stderr.write(parsed.content);
          break;
        case 'exec_start':
          console.log(`\n[EXEC ${parsed.host}] ${parsed.command}`);
          break;
        case 'exec_result':
          console.log(`[RESULT] ${parsed.output}`);
          break;
        case 'exec_error':
          console.log(`[ERROR] ${parsed.error}`);
          break;
        case 'context':
          console.log(`\n[TOKENS] prompt:${parsed.promptTokens} eval:${parsed.evalTokens}`);
          break;
        default:
          // Aqui es donde se perdian las respuestas largas sin dejar rastro.
          console.error(`[CLI] evento no manejado '${parsed.type}': ` +
                        JSON.stringify(parsed).slice(0, 300));
      }
    }
  }

  console.log('');
  if (printed === 0) {
    if (thought > 0) {
      console.error(`[CLI] el modelo se quedo razonando (${thought} caracteres) ` +
                    `y no llego a responder. Suele pasar con peticiones largas: ` +
                    `parte la tarea en trozos o usa TITAN_THINKING=1 para verlo.`);
    } else {
      console.error(`[CLI] el stream no trajo texto. Tipos vistos: ` +
                    `${[...seenTypes].join(', ') || 'ninguno'}. ` +
                    `Reintenta con TITAN_DEBUG=1 para ver los eventos crudos.`);
    }
    process.exitCode = 2;
  }
}

async function main() {
  switch (command) {
    case 'chat': {
      const { model: modelPedido, message } = parseModelAndMessage(args);
      const model = await resolveModel(modelPedido);
      if (!message) { console.error('Usage: titan-cli chat [modelo|-m modelo] <mensaje>'); process.exit(1); }
      const resp = await authFetch(`${TITAN_HOST}/api/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: message }],
          sshConnections: []
        })
      });
      await streamResponse(resp);
      break;
    }
    // Comprueba las capas por separado. El fallo tipico no es "el modelo no
    // contesta" sino que una capa de abajo esta caida, y desde el CLI las dos
    // cosas se parecian demasiado.
    case 'health': {
      const ollamaHost = process.env.TITAN_OLLAMA ||
                         `http://${new URL(TITAN_HOST).hostname}:11434`;
      const probe = async (label, fn) => {
        try {
          console.log(`${label}: ${await fn()}`);
        } catch (err) {
          console.log(`${label}: CAIDO (${err.message})`);
        }
      };

      await probe('1. servidor Titan  ', async () => {
        const r = await authFetch(`${TITAN_HOST}/api/models`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return `OK (${(await r.json()).models.length} modelos)`;
      });

      await probe('2. Ollama vivo     ', async () => {
        const r = await fetch(`${ollamaHost}/api/version`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return `OK (v${(await r.json()).version})`;
      });

      // Esta es la que importa: los endpoints de metadatos siguen respondiendo
      // aunque el runner de inferencia no arranque.
      await probe('3. inferencia      ', async () => {
        const r = await fetch(`${ollamaHost}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: await resolveModel(TITAN_MODEL), prompt: 'hi', stream: false })
        });
        if (!r.ok) {
          throw new Error(`HTTP ${r.status} — Ollama responde pero no genera. ` +
                          `Reinicia Ollama en el servidor y mira su log.`);
        }
        return `OK (${(await r.json()).eval_count} tokens)`;
      });
      break;
    }
    case 'models': {
      const resp = await authFetch(`${TITAN_HOST}/api/models`);
      const data = await resp.json();
      data.models.forEach(m => {
        console.log(`${m.name} (${m.details.parameter_size}, ${m.details.quantization_level})`);
      });
      break;
    }
    case 'gpu': {
      const resp = await authFetch(`${TITAN_HOST}/api/gpu`);
      const data = await resp.json();
      console.log(`GPU: ${data.name} | Load: ${data.gpuLoad}% | VRAM: ${(data.vramUsed/1024).toFixed(1)}/${(data.vramTotal/1024).toFixed(1)}GB | Temp: ${data.temp}°C`);
      break;
    }
    case 'exec': {
      const host = args[0];
      const cmd = args.slice(1).join(' ');
      if (!host || !cmd) { console.error('Usage: titan-cli exec <host> <command>'); process.exit(1); }
      // TITAN_SSH_USER/TITAN_SSH_PASS: sin esto el server cae a la clave SSH por
      // defecto, que solo sirve si ese host la tiene autorizada.
      const resp = await authFetch(`${TITAN_HOST}/api/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          username: process.env.TITAN_SSH_USER || 'emilio',
          password: process.env.TITAN_SSH_PASS,
          command: cmd,
        })
      });
      const data = await resp.json();
      if (data.error) console.error('Error:', data.error);
      else console.log(data.output);
      break;
    }
    case 'search': {
      const query = args.join(' ');
      if (!query) { console.error('Usage: titan-cli search <query>'); process.exit(1); }
      const resp = await authFetch(`${TITAN_HOST}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await resp.json();
      if (data.results) data.results.forEach((r, i) => console.log(`${i+1}. ${r.title}\n   ${r.snippet}\n   ${r.url}\n`));
      else console.log(data);
      break;
    }
    case 'web': {
      const url = args[0];
      if (!url) { console.error('Usage: titan-cli web <url>'); process.exit(1); }
      const resp = await authFetch(`${TITAN_HOST}/api/web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await resp.json();
      console.log(`Title: ${data.title}\n\n${data.content}`);
      break;
    }
    case 'restart-ollama': {
      const resp = await authFetch(`${TITAN_HOST}/api/ollama/restart`, { method: 'POST' });
      const data = await resp.json();
      console.log(data.ok ? 'Ollama reiniciado' : `Error: ${data.error}`);
      break;
    }
    case 'agent': {
      const { model: modelPedido, message } = parseModelAndMessage(args);
      const model = await resolveModel(modelPedido);
      if (!message) { console.error('Usage: titan-cli agent [modelo|-m modelo] <mensaje>'); process.exit(1); }
      const sshConnections = [
        { name: 'geodrone', host: '10.0.0.17', port: 22, username: 'emilio' },
        { name: 'hermes', host: '10.0.0.21', port: 22, username: 'emilio' },
        // La contraseña se lee del entorno: este repo es publico.
        // Ej: TITAN_WS_PASS=xxxxx node titan-cli.js agent ...
        { name: 'workstation', host: '10.0.0.7', port: 22, username: 'GEODRONE', password: process.env.TITAN_WS_PASS }
      ];
      const resp = await authFetch(`${TITAN_HOST}/api/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: message }], sshConnections })
      });
      await streamResponse(resp);
      break;
    }
    default:
      console.log(`TITAN CLI - Orquestador de Titan Agent
Uso: titan-cli <comando> [args]

Comandos:
  health                      Comprueba servidor, Ollama e inferencia por capas
  models                      Lista modelos disponibles
  gpu                         Estado de la GPU
  chat [modelo] <mensaje>     Chat simple (sin SSH). Modelo opcional: nombre:tag o -m <modelo>
  agent [modelo] <mensaje>    Chat agentico (con SSH a todos los servers)
  exec <host> <comando>       Ejecutar comando SSH
  search <query>              Buscar en internet
  web <url>                   Leer pagina web
  restart-ollama              Reiniciar Ollama

Variables de entorno:
  TITAN_HOST                  URL del servidor (default: http://10.0.0.21:3001, RTX 3090. .6:3000 sigue vivo, pasar TITAN_HOST para usarlo)
  TITAN_MODEL                 Modelo por defecto (si no, el preferido del servidor)
  TITAN_THINKING=1            Muestra el razonamiento del modelo por stderr
  TITAN_DEBUG=1               Vuelca los eventos crudos del stream`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
