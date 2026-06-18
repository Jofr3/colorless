import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outPrefix = process.argv[2] || '/tmp/cdp-prof/page';

async function getPageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(BASE + '/json')).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg && pg.webSocketDebuggerUrl) return pg;
    } catch {}
    await sleep(250);
  }
  throw new Error('no page target / CDP not reachable');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) this.handlers.forEach((h) => h(m));
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.handlers.push(fn); }
}

const target = await getPageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const cdp = new CDP(ws);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const loaded = new Promise((r) => cdp.on((m) => { if (m.method === 'Page.loadEventFired') r(); }));
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
await Promise.race([loaded, sleep(8000)]);
await sleep(1800); // hydrate + fonts + glow transition

// Park the cursor spotlight under the first menu card; report its rect.
const evalRes = await cdp.send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const bd = document.querySelector('.app-backdrop');
    const card = document.querySelector('nav a');
    if (!bd || !card) return { ok:false, bodyLen: document.body.innerHTML.length };
    const r = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const bdr = bd.getBoundingClientRect();
    bd.style.setProperty('--cursor-x', (r.left + r.width/2 - bdr.left) + 'px');
    bd.style.setProperty('--cursor-y', (r.top + r.height/2 - bdr.top) + 'px');
    const a = document.querySelector('.app-backdrop::after');
    return { ok:true,
      rect:{ x:r.left, y:r.top, w:r.width, h:r.height },
      cardBackdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      cardBg: cs.backgroundColor };
  })()`,
});
console.log('EVAL', JSON.stringify(evalRes.result.value));
await sleep(800);

// Full viewport shot
const full = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(outPrefix + '_full.png', Buffer.from(full.data, 'base64'));

// Tight clip around the card (CSS px), 2x scale for detail
const rc = evalRes.result.value.rect;
if (rc) {
  const pad = 18;
  const clip = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rc.x - pad, y: rc.y - pad, width: rc.w + pad * 2, height: rc.h + pad * 2, scale: 2 },
  });
  fs.writeFileSync(outPrefix + '_card.png', Buffer.from(clip.data, 'base64'));
}
console.log('WROTE', outPrefix + '_full.png', outPrefix + '_card.png');
ws.close();
process.exit(0);
