#!/usr/bin/env node
// Banco de pruebas de Titan Agent.
//
// Corre cada tarea N veces y puntua las respuestas contra hechos ya verificados
// a mano, no contra criterio subjetivo. Varias comprobaciones son NEGATIVAS:
// vigilan errores concretos que ya ocurrieron, para detectar regresiones.
//
// Uso:
//   node bench/bench.js [modelo] [repeticiones]
//   WS_PASS=xxx node bench/bench.js gemma4:12b 3
//
// WS_PASS solo hace falta para la tarea de SSH; sin el, esa tarea se omite.

const HOST = process.env.TITAN_HOST || 'http://10.0.0.6:3000';
const MODEL = process.argv[2] || 'gemma4:12b';
const RUNS = parseInt(process.argv[3], 10) || 3;
const WS_PASS = process.env.WS_PASS;

const SSH_WORKSTATION = [{ name: 'workstation', host: '10.0.0.6', port: 22, username: 'GEODRONE', password: WS_PASS }];

// Hechos verificados a mano contra el hardware y los repositorios reales.
const TAREAS = [
  {
    id: 'hardware',
    titulo: 'Diagnostico de hardware (exec + calculo)',
    requiereSsh: true,
    prompt: 'Diagnostica el servidor workstation con comandos reales y respondeme: 1) que GPU tiene y cuanta VRAM total, 2) cuanta VRAM esta libre ahora mismo, 3) que modelos de Ollama hay descargados y cuanto pesa cada uno, 4) cual es el modelo mas grande que cabe COMPLETO en la VRAM sin desbordar a RAM. Explica el calculo con los numeros reales que obtuviste.',
    checks: [
      { label: 'identifica la RTX 3060', test: t => /RTX\s*3060/i.test(t) },
      { label: 'VRAM total 12288 o 12 GB', test: t => /12[.,]?288|12\s*GB/i.test(t) },
      { label: 'gemma4:26b = 17 GB', test: t => /17\s*GB/i.test(t) },
      { label: 'gemma4:12b = 7.6 GB', test: t => /7[.,]6\s*GB/i.test(t) },
      { label: 'modelos qwen = 9.0 GB', test: t => /9[.,]0\s*GB/i.test(t) },
      { label: 'NEG: no afirma que el 26b cabe en VRAM', test: t => !/26b[^.]{0,80}(cabe|entra)\b/i.test(t) },
      { label: 'contrasta con la VRAM libre actual', test: t => /libre|ocupad|disponible|actual/i.test(t) && /no\s+(cabe|puede|entra)|ninguno|no\s+bajo/i.test(t) },
    ],
  },
  {
    id: 'firmware',
    titulo: 'Investigacion de firmware (search + web)',
    requiereSsh: false,
    prompt: 'Necesito el firmware para la pantalla BIGTREETECH TFT35 V1.2 con chip STM32. Busca el repositorio oficial en GitHub, revisa la estructura y dame: 1) el chip STM32 exacto, 2) el controlador de pantalla, 3) la estructura de archivos, 4) como compilarlo.',
    checks: [
      { label: 'chip STM32F103', test: t => /STM32F103/i.test(t) },
      { label: 'cita buildroot o Bootloaders como fuente', test: t => /buildroot|bootloader/i.test(t) },
      { label: 'estructura real: carpeta TFT', test: t => /\bTFT\//.test(t) },
      { label: 'menciona platformio.ini', test: t => /platformio\.ini/i.test(t) },
      { label: 'NEG: no inventa el entorno BIQU_TFT35_V1.2', test: t => !/BIQU_TFT35_V1\.2/i.test(t) },
    ],
  },
  {
    id: 'fastapi',
    titulo: 'Documentacion Python (search + web + codigo)',
    requiereSsh: false,
    prompt: 'En FastAPI el decorador @app.on_event("startup") esta deprecado. Busca la documentacion oficial actual y dime cual es el reemplazo correcto. Dame un ejemplo de codigo completo y funcional que abra una conexion a base de datos al arrancar y la cierre al apagar.',
    checks: [
      { label: 'identifica lifespan', test: t => /lifespan/i.test(t) },
      { label: 'usa asynccontextmanager', test: t => /asynccontextmanager/i.test(t) },
      { label: 'cita la documentacion oficial', test: t => /fastapi\.tiangolo\.com|documentacion oficial|documentación oficial/i.test(t) },
      { label: 'NEG: no duplica la respuesta', test: t => (t.match(/app\s*=\s*FastAPI\(lifespan/g) || []).length <= 1 },
    ],
  },
];

async function correr(tarea) {
  const conns = tarea.requiereSsh ? SSH_WORKSTATION : [];
  const t0 = Date.now();
  const resp = await fetch(`${HOST}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: tarea.prompt }], sshConnections: conns }),
  });

  const rd = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', iter = 0, tools = 0;
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
        if (p.type === 'text') text += p.content;
        else if (p.type === 'context') iter++;
        else if (p.type === 'exec_start') tools++;
      } catch {}
    }
  }
  return { text, iter, tools, segs: (Date.now() - t0) / 1000 };
}

(async () => {
  console.log(`Banco de pruebas — modelo ${MODEL}, ${RUNS} repeticiones por tarea`);
  console.log(`Servidor: ${HOST}\n`);

  const resumen = [];

  for (const tarea of TAREAS) {
    if (tarea.requiereSsh && !WS_PASS) {
      console.log(`\n### ${tarea.titulo}\n  OMITIDA: requiere WS_PASS en el entorno\n`);
      continue;
    }
    console.log(`\n${'='.repeat(72)}\n${tarea.titulo}\n${'='.repeat(72)}`);

    const puntajes = [];
    const fallosPorCheck = new Map();

    for (let i = 1; i <= RUNS; i++) {
      let r;
      try {
        r = await correr(tarea);
      } catch (e) {
        console.log(`  corrida ${i}: ERROR ${e.message}`);
        puntajes.push(0);
        continue;
      }
      const pasados = tarea.checks.filter(c => {
        const ok = c.test(r.text);
        if (!ok) fallosPorCheck.set(c.label, (fallosPorCheck.get(c.label) || 0) + 1);
        return ok;
      }).length;
      const pct = Math.round((pasados / tarea.checks.length) * 100);
      puntajes.push(pct);
      console.log(`  corrida ${i}: ${pasados}/${tarea.checks.length} (${pct}%) — ${r.iter} iter, ${r.tools} herram., ${r.segs.toFixed(0)}s`);
    }

    const media = Math.round(puntajes.reduce((a, b) => a + b, 0) / puntajes.length);
    const min = Math.min(...puntajes), max = Math.max(...puntajes);
    console.log(`  --> media ${media}%  (min ${min}%, max ${max}%, variacion ${max - min} puntos)`);
    if (fallosPorCheck.size) {
      console.log('  comprobaciones falladas:');
      for (const [label, veces] of fallosPorCheck) console.log(`    - ${label}  (${veces}/${RUNS} corridas)`);
    }
    resumen.push({ tarea: tarea.id, media, min, max });
  }

  console.log(`\n${'='.repeat(72)}\nRESUMEN — ${MODEL}\n${'='.repeat(72)}`);
  for (const r of resumen) console.log(`  ${r.tarea.padEnd(12)} media ${String(r.media).padStart(3)}%   rango ${r.min}-${r.max}%`);
  if (resumen.length) {
    const global = Math.round(resumen.reduce((a, r) => a + r.media, 0) / resumen.length);
    console.log(`  ${'GLOBAL'.padEnd(12)} ${String(global).padStart(9)}%`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
