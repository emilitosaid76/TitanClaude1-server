#!/usr/bin/env node
const TITAN_HOST = process.env.TITAN_HOST || 'http://10.0.0.6:3000';

const [,, command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'chat': {
      const model = args[0] || 'gemma4:26b';
      const message = args.slice(1).join(' ');
      if (!message) { console.error('Usage: titan-cli chat <model> <message>'); process.exit(1); }
      const resp = await fetch(`${TITAN_HOST}/api/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: message }],
          sshConnections: []
        })
      });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text') process.stdout.write(parsed.content);
            else if (parsed.type === 'exec_start') console.log(`\n[EXEC ${parsed.host}] ${parsed.command}`);
            else if (parsed.type === 'exec_result') console.log(`[RESULT] ${parsed.output}`);
            else if (parsed.type === 'exec_error') console.log(`[ERROR] ${parsed.error}`);
            else if (parsed.type === 'context') console.log(`\n[TOKENS] prompt:${parsed.promptTokens} eval:${parsed.evalTokens}`);
          } catch {}
        }
      }
      console.log('');
      break;
    }
    case 'models': {
      const resp = await fetch(`${TITAN_HOST}/api/models`);
      const data = await resp.json();
      data.models.forEach(m => {
        console.log(`${m.name} (${m.details.parameter_size}, ${m.details.quantization_level})`);
      });
      break;
    }
    case 'gpu': {
      const resp = await fetch(`${TITAN_HOST}/api/gpu`);
      const data = await resp.json();
      console.log(`GPU: ${data.name} | Load: ${data.gpuLoad}% | VRAM: ${(data.vramUsed/1024).toFixed(1)}/${(data.vramTotal/1024).toFixed(1)}GB | Temp: ${data.temp}°C`);
      break;
    }
    case 'exec': {
      const host = args[0];
      const cmd = args.slice(1).join(' ');
      if (!host || !cmd) { console.error('Usage: titan-cli exec <host> <command>'); process.exit(1); }
      const resp = await fetch(`${TITAN_HOST}/api/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, username: 'emilio', command: cmd })
      });
      const data = await resp.json();
      if (data.error) console.error('Error:', data.error);
      else console.log(data.output);
      break;
    }
    case 'search': {
      const query = args.join(' ');
      if (!query) { console.error('Usage: titan-cli search <query>'); process.exit(1); }
      const resp = await fetch(`${TITAN_HOST}/api/search`, {
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
      const resp = await fetch(`${TITAN_HOST}/api/web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await resp.json();
      console.log(`Title: ${data.title}\n\n${data.content}`);
      break;
    }
    case 'restart-ollama': {
      const resp = await fetch(`${TITAN_HOST}/api/ollama/restart`, { method: 'POST' });
      const data = await resp.json();
      console.log(data.ok ? 'Ollama reiniciado' : `Error: ${data.error}`);
      break;
    }
    case 'agent': {
      const model = args[0] || 'gemma4:26b';
      const message = args.slice(1).join(' ');
      const sshConnections = [
        { name: 'geodrone', host: '10.0.0.17', port: 22, username: 'emilio' },
        { name: 'hermes', host: '10.0.0.21', port: 22, username: 'emilio' },
        // La contraseña se lee del entorno: este repo es publico.
        // Ej: TITAN_WS_PASS=xxxxx node titan-cli.js agent ...
        { name: 'workstation', host: '10.0.0.6', port: 22, username: 'GEODRONE', password: process.env.TITAN_WS_PASS }
      ];
      const resp = await fetch(`${TITAN_HOST}/api/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: message }], sshConnections })
      });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text') process.stdout.write(parsed.content);
            else if (parsed.type === 'exec_start') console.log(`\n[EXEC ${parsed.host}] ${parsed.command}`);
            else if (parsed.type === 'exec_result') console.log(`[RESULT] ${parsed.output}`);
            else if (parsed.type === 'exec_error') console.log(`[ERROR] ${parsed.error}`);
          } catch {}
        }
      }
      console.log('');
      break;
    }
    default:
      console.log(`TITAN CLI - Orquestador de Titan Agent
Uso: titan-cli <comando> [args]

Comandos:
  models                      Lista modelos disponibles
  gpu                         Estado de la GPU
  chat <modelo> <mensaje>     Chat simple (sin SSH)
  agent <modelo> <mensaje>    Chat agentico (con SSH a todos los servers)
  exec <host> <comando>       Ejecutar comando SSH
  search <query>              Buscar en internet
  web <url>                   Leer pagina web
  restart-ollama              Reiniciar Ollama

Variables de entorno:
  TITAN_HOST                  URL del servidor (default: http://10.0.0.6:3000)`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
