const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Client } = require('ssh2');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/ssh' });

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = process.env.OLLAMA_PORT || 11434;
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const cheerio = require('cheerio');

let savedSSHConns = [];

app.get('/api/gpu', (_req, res) => {
  try {
    const out = execSync('nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,name,temperature.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString().trim();
    const parts = out.split(',').map(s => s.trim());
    res.json({ gpuLoad: parseInt(parts[0]), vramUsed: parseInt(parts[1]), vramTotal: parseInt(parts[2]), name: parts[3], temp: parseInt(parts[4]) });
  } catch (e) {
    res.status(500).json({ error: 'nvidia-smi not available' });
  }
});

app.get('/api/models', async (_req, res) => {
  try {
    const resp = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`);
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Cannot reach Ollama at ' + OLLAMA_HOST });
  }
});

app.post('/api/ssh/save', (req, res) => {
  const { connections } = req.body;
  savedSSHConns = connections || [];
  res.json({ ok: true });
});

app.get('/api/ssh/list', (_req, res) => {
  res.json(savedSSHConns.map(c => ({ name: c.name, host: c.host, username: c.username })));
});

// Execute a command on a remote host via SSH
app.post('/api/exec', async (req, res) => {
  const { host, port, username, password, command } = req.body;
  if (!host || !username || !command) {
    return res.status(400).json({ error: 'Missing host, username, or command' });
  }

  const conn = new Client();
  let output = '';
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    conn.end();
  }, 30000);

  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timeout);
        conn.end();
        return res.json({ output: '', error: err.message });
      }
      stream.on('data', (data) => { output += data.toString(); });
      stream.stderr.on('data', (data) => { output += data.toString(); });
      stream.on('close', (code) => {
        clearTimeout(timeout);
        conn.end();
        res.json({ output, exitCode: code });
      });
    });
  });

  conn.on('error', (err) => {
    clearTimeout(timeout);
    res.json({ output: '', error: timedOut ? 'Command timed out (30s)' : err.message });
  });

  conn.connect({ host, port: port || 22, username, password });
});

// Agentic chat: streams response, detects exec blocks, runs them, feeds results back
app.post('/api/agent', async (req, res) => {
  const { model, messages, sshConnections } = req.body;

  const systemPrompt = buildSystemPrompt(sshConnections || []);
  const allMessages = [{ role: 'system', content: systemPrompt }, ...messages];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await agentLoop(model, allMessages, sshConnections || [], res);
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', text: e.message })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

// Web fetch endpoint
app.post('/api/web', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    const html = await resp.text();
    const $ = cheerio.load(html);
    $('script,style,nav,footer,header,iframe,noscript').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
    res.json({ url, title: $('title').text(), content: text });
  } catch (e) {
    res.json({ url, error: e.message });
  }
});

// Web search endpoint (DuckDuckGo HTML)
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  try {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000)
    });
    const html = await resp.text();
    const $ = cheerio.load(html);
    const results = [];
    $('.result').each((i, el) => {
      if (i >= 5) return false;
      const title = $(el).find('.result__title a').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      const href = $(el).find('.result__title a').attr('href') || '';
      if (title) results.push({ title, snippet, url: href });
    });
    res.json({ query, results });
  } catch (e) {
    res.json({ query, error: e.message });
  }
});

function buildSystemPrompt(connections) {
  const connList = connections.length > 0
    ? connections.map(c => `- ${c.name}: ${c.username}@${c.host}`).join('\n')
    : '(ninguna configurada)';

  return `Eres un asistente de sistemas experto. Tienes acceso directo a ejecutar comandos en servidores remotos via SSH.

CONEXIONES SSH DISPONIBLES:
${connList}

INSTRUCCIONES IMPORTANTES:
- Cuando el usuario te pida hacer algo en un servidor, EJECUTA los comandos directamente. No le digas al usuario que los ejecute manualmente.
- Para ejecutar un comando, usa este formato exacto:

\`\`\`exec
host: <ip-o-nombre-del-host>
command: <comando-a-ejecutar>
\`\`\`

- Puedes ejecutar multiples comandos en secuencia poniendo multiples bloques exec.
- Despues de cada ejecucion recibiras el resultado. Analiza el resultado y responde al usuario.
- Si necesitas conectarte a un host que esta en la lista, usa su IP directamente.
- Puedes encadenar comandos con && o ; en un solo bloque exec.
- Para tareas complejas, divide en pasos y ejecuta uno a uno.
- Siempre analiza y explica los resultados de forma clara y util.
- Si un comando falla, intenta diagnosticar el problema.
- Responde en el mismo idioma que el usuario.

ACCESO A INTERNET:
- Puedes buscar en la web y consultar paginas. Usa estos formatos:

\`\`\`search
query: <tu busqueda>
\`\`\`

\`\`\`web
url: <url-a-consultar>
\`\`\`

- Usa search para buscar informacion actualizada en internet.
- Usa web para leer el contenido de una pagina especifica.
- Combina busqueda + lectura para dar respuestas basadas en informacion actual.`;
}

async function agentLoop(model, messages, sshConnections, res, depth = 0) {
  if (depth > 100) {
    res.write(`data: ${JSON.stringify({ type: 'text', content: '\n\n*Se alcanzó el límite de ejecuciones automáticas.*' })}\n\n`);
    return;
  }

  // Call Ollama
  const ollamaResp = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  const reader = ollamaResp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            fullResponse += parsed.message.content;
            res.write(`data: ${JSON.stringify({ type: 'text', content: parsed.message.content })}\n\n`);
          }
          if (parsed.done && (parsed.prompt_eval_count || parsed.eval_count)) {
            res.write(`data: ${JSON.stringify({ type: 'context', promptTokens: parsed.prompt_eval_count || 0, evalTokens: parsed.eval_count || 0 })}\n\n`);
          }
        } catch {}
      }
    }
  }
  if (buf.trim()) {
    try {
      const parsed = JSON.parse(buf);
      if (parsed.message?.content) {
        fullResponse += parsed.message.content;
        res.write(`data: ${JSON.stringify({ type: 'text', content: parsed.message.content })}\n\n`);
      }
      if (parsed.done && (parsed.prompt_eval_count || parsed.eval_count)) {
        res.write(`data: ${JSON.stringify({ type: 'context', promptTokens: parsed.prompt_eval_count || 0, evalTokens: parsed.eval_count || 0 })}\n\n`);
      }
    } catch {}
  }

  // Check for exec, search, and web blocks
  const execBlocks = parseExecBlocks(fullResponse);
  const searchBlocks = parseSearchBlocks(fullResponse);
  const webBlocks = parseWebBlocks(fullResponse);
  if (execBlocks.length === 0 && searchBlocks.length === 0 && webBlocks.length === 0) return;

  // Execute each block
  messages.push({ role: 'assistant', content: fullResponse });

  for (const block of execBlocks) {
    const conn = findConnection(block.host, sshConnections);
    if (!conn) {
      const errMsg = `\n\n> No se encontró conexión SSH para el host "${block.host}". Hosts disponibles: ${sshConnections.map(c => c.host).join(', ')}`;
      res.write(`data: ${JSON.stringify({ type: 'exec_error', host: block.host, error: errMsg })}\n\n`);
      messages.push({ role: 'user', content: `[ERROR: No hay conexión SSH configurada para ${block.host}]` });
      continue;
    }

    res.write(`data: ${JSON.stringify({ type: 'exec_start', host: conn.host, command: block.command })}\n\n`);

    try {
      const result = await executeSSH(conn, block.command);
      const outputText = result.error
        ? `Error: ${result.error}`
        : (result.output || '(sin salida)');

      res.write(`data: ${JSON.stringify({ type: 'exec_result', host: conn.host, command: block.command, output: outputText, exitCode: result.exitCode })}\n\n`);
      messages.push({ role: 'user', content: `[Resultado de ejecutar "${block.command}" en ${conn.host}]:\n${outputText}` });
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'exec_error', host: conn.host, error: e.message })}\n\n`);
      messages.push({ role: 'user', content: `[Error ejecutando comando en ${conn.host}]: ${e.message}` });
    }
  }

  // Handle search blocks
  for (const block of searchBlocks) {
    res.write(`data: ${JSON.stringify({ type: 'exec_start', host: 'web', command: `search: ${block.query}` })}\n\n`);
    try {
      const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(block.query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000)
      });
      const html = await resp.text();
      const $ = cheerio.load(html);
      const results = [];
      $('.result').each((i, el) => {
        if (i >= 5) return false;
        const title = $(el).find('.result__title a').text().trim();
        const snippet = $(el).find('.result__snippet').text().trim();
        const href = $(el).find('.result__title a').attr('href') || '';
        if (title) results.push(`${title}\n${snippet}\n${href}`);
      });
      const output = results.join('\n\n') || '(sin resultados)';
      res.write(`data: ${JSON.stringify({ type: 'exec_result', host: 'web', command: `search: ${block.query}`, output })}\n\n`);
      messages.push({ role: 'user', content: `[Resultados de buscar "${block.query}"]:\n${output}` });
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'exec_error', host: 'web', error: e.message })}\n\n`);
      messages.push({ role: 'user', content: `[Error buscando "${block.query}"]: ${e.message}` });
    }
  }

  // Handle web blocks
  for (const block of webBlocks) {
    res.write(`data: ${JSON.stringify({ type: 'exec_start', host: 'web', command: `web: ${block.url}` })}\n\n`);
    try {
      const resp = await fetch(block.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      const html = await resp.text();
      const $ = cheerio.load(html);
      $('script,style,nav,footer,header,iframe,noscript').remove();
      const title = $('title').text();
      const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
      const output = `Titulo: ${title}\n\n${text}`;
      res.write(`data: ${JSON.stringify({ type: 'exec_result', host: 'web', command: `web: ${block.url}`, output })}\n\n`);
      messages.push({ role: 'user', content: `[Contenido de ${block.url}]:\n${output}` });
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'exec_error', host: 'web', error: e.message })}\n\n`);
      messages.push({ role: 'user', content: `[Error consultando ${block.url}]: ${e.message}` });
    }
  }

  // Continue the agent loop so the model can analyze results
  await agentLoop(model, messages, sshConnections, res, depth + 1);
}

function parseExecBlocks(text) {
  const blocks = [];
  const regex = /```exec\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trim();
    const lines = content.split('\n');
    let host = '', command = '';
    for (const line of lines) {
      const hostMatch = line.match(/^host:\s*(.+)/i);
      const cmdMatch = line.match(/^command:\s*(.+)/i);
      if (hostMatch) host = hostMatch[1].trim();
      if (cmdMatch) command = cmdMatch[1].trim();
    }
    // Support multiline commands after "command:" line
    if (!command) {
      const cmdIdx = lines.findIndex(l => /^command:/i.test(l));
      if (cmdIdx >= 0) {
        command = lines[cmdIdx].replace(/^command:\s*/i, '') + '\n' + lines.slice(cmdIdx + 1).join('\n');
        command = command.trim();
      }
    }
    if (host && command) blocks.push({ host, command });
  }
  return blocks;
}

function parseSearchBlocks(text) {
  const blocks = [];
  const regex = /```search\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trim();
    const qMatch = content.match(/^query:\s*(.+)/im);
    if (qMatch) blocks.push({ query: qMatch[1].trim() });
  }
  return blocks;
}

function parseWebBlocks(text) {
  const blocks = [];
  const regex = /```web\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trim();
    const uMatch = content.match(/^url:\s*(.+)/im);
    if (uMatch) blocks.push({ url: uMatch[1].trim() });
  }
  return blocks;
}

function findConnection(host, connections) {
  return connections.find(c => c.host === host || c.name.toLowerCase() === host.toLowerCase());
}

function executeSSH(conn, command) {
  return new Promise((resolve) => {
    const client = new Client();
    let output = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      client.end();
    }, 30000);

    client.on('ready', () => {
      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          return resolve({ output: '', error: err.message });
        }
        stream.on('data', (data) => { output += data.toString(); });
        stream.stderr.on('data', (data) => { output += data.toString(); });
        stream.on('close', (code) => {
          clearTimeout(timeout);
          client.end();
          resolve({ output, exitCode: code });
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ output: '', error: timedOut ? 'Timeout (30s)' : err.message });
    });

    client.connect({
      host: conn.host,
      port: conn.port || 22,
      username: conn.username,
      password: conn.password,
    });
  });
}

// Interactive SSH terminal via WebSocket (kept for manual terminal tabs)
wss.on('connection', (ws) => {
  let sshClient = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'connect') {
      sshClient = new Client();
      sshClient.on('ready', () => {
        ws.send(JSON.stringify({ type: 'status', text: 'connected' }));
        sshClient.shell({ term: 'xterm-256color', cols: msg.cols || 120, rows: msg.rows || 30 }, (err, stream) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'error', text: err.message }));
            return;
          }
          stream.on('data', (data) => {
            ws.send(JSON.stringify({ type: 'data', data: data.toString('base64') }));
          });
          stream.on('close', () => {
            ws.send(JSON.stringify({ type: 'status', text: 'disconnected' }));
            sshClient.end();
          });
          ws.on('message', (raw2) => {
            let m2;
            try { m2 = JSON.parse(raw2); } catch { return; }
            if (m2.type === 'input') stream.write(Buffer.from(m2.data, 'base64'));
            if (m2.type === 'resize') stream.setWindow(m2.rows, m2.cols, 0, 0);
          });
        });
      });
      sshClient.on('error', (err) => {
        ws.send(JSON.stringify({ type: 'error', text: err.message }));
      });
      sshClient.connect({
        host: msg.host,
        port: msg.port || 22,
        username: msg.username,
        password: msg.password,
        privateKey: msg.privateKey || undefined,
      });
    }
  });

  ws.on('close', () => {
    if (sshClient) sshClient.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ollama Workstation running at http://0.0.0.0:${PORT}`);
  console.log(`Ollama backend: ${OLLAMA_HOST}:${OLLAMA_PORT}`);
});
