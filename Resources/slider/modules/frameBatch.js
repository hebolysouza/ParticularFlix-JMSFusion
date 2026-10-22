// Fork ParticularFlix 3.8.2.25: agrupa leituras e escritas de layout de varios componentes em UM quadro.
// Sem isso, cada fileira le o layout (scrollWidth, clientWidth) logo depois de outra ter escrito no DOM, e o
// navegador recalcula o layout varias vezes por quadro ("forced reflow"). Aqui todas as leituras do quadro
// rodam primeiro e so depois todas as escritas.
const reads = [];
const writes = [];
let queued = false;
let running = false;

function run() {
  queued = false;
  running = true;
  const r = reads.splice(0);
  for (const fn of r) {
    try { fn(); } catch {}
  }
  const w = writes.splice(0);
  for (const fn of w) {
    try { fn(); } catch {}
  }
  running = false;
  if (reads.length || writes.length) flush();
}

function flush() {
  if (queued || running) return;
  queued = true;
  requestAnimationFrame(run);
}

export function measure(fn) {
  reads.push(fn);
  flush();
}

export function mutate(fn) {
  writes.push(fn);
  flush();
}
