// PROTOTYPE measurement for ticket #7. Throwaway.
import { chromium } from '/Users/robinsverd/Thrivbe-AI/Thrivbe-OS/skills/research/website-crawler/node_modules/playwright-core/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_ = process.env.URL_ || 'http://127.0.0.1:3031/';
const OUT = new URL('./measure/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const HEADED = process.env.HEADED === '1';

const browser = await chromium.launch({
  executablePath: '/Users/robinsverd/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  headless: !HEADED,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-precise-memory-info'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Network.enable');

const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });

// network bytes per host, reset per scenario
const reqUrl = new Map();
let net = {};
cdp.on('Network.requestWillBeSent', e => reqUrl.set(e.requestId, e.request.url));
cdp.on('Network.loadingFinished', e => {
  const u = reqUrl.get(e.requestId); if (!u) return;
  let h; try { h = new URL(u).host; } catch { h = 'other'; }
  if (/overpass|maps\.mail\.ru/.test(u)) h = 'OVERPASS:' + h;
  net[h] = net[h] || { n: 0, kB: 0 };
  net[h].n++; net[h].kB += e.encodedDataLength / 1024;
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));

async function frames(ms) {
  return page.evaluate(ms => new Promise(res => {
    const t = []; const start = performance.now();
    const f = now => { t.push(now); if (now - start < ms) requestAnimationFrame(f); else {
      const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
      const q = p => +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1);
      res({ fps: +(d.length / (ms / 1000)).toFixed(1), p50: q(.5), p95: q(.95), p99: q(.99), longFrames50ms: d.filter(x => x > 50).length });
    } };
    requestAnimationFrame(f);
  }), ms);
}

const results = [];
async function scenario(name, fn, ms = 8000) {
  await fn();
  await page.evaluate(() => new Promise(r => { const m = window.__floodDebug?.map; if (!m) return r(); m.loaded() ? r() : m.once('idle', r); setTimeout(r, 15000); }));
  await sleep(1500);
  net = {};
  const m0 = await metrics();
  const fr = await frames(ms);
  const m1 = await metrics();
  const stats = await page.evaluate(() => { const h = window.__floodDebug?.handle?.(); return h ? h.stats() : null; });
  const zoom = await page.evaluate(() => window.__floodDebug?.map?.getZoom?.());
  const row = {
    name, zoom: zoom && +zoom.toFixed(2), ...fr,
    cpuBusyPct: +(100 * (m1.TaskDuration - m0.TaskDuration) / (ms / 1000)).toFixed(1),
    scriptPct: +(100 * (m1.ScriptDuration - m0.ScriptDuration) / (ms / 1000)).toFixed(1),
    heapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1),
    netDuring: Object.fromEntries(Object.entries(net).map(([k, v]) => [k, `${v.n} req ${v.kB.toFixed(0)} kB`])),
    flood: stats,
  };
  results.push(row);
  console.log(JSON.stringify(row));
  await page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 60 });
}

async function toggleFlood() {
  if (!(await page.getByText('Bangkok flood').first().isVisible().catch(() => false))) { await page.locator('button[aria-label="SITUATIONS"]').click(); await sleep(700); }
  await page.getByText('Bangkok flood').first().click();
  await sleep(500);
}

await page.goto(URL_, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 120000 });
await sleep(8000); // splash + core feeds
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
console.log('GPU', gl);


const pan = async () => { await page.evaluate(() => { const m = window.__floodDebug?.map || window.__m; let b = m.getBearing(); const id = setInterval(() => { b += 2; m.setBearing(b); }, 33); setTimeout(() => clearInterval(id), 11000); }); };
const throttle = r => cdp.send('Emulation.setCPUThrottlingRate', { rate: r });
// load phase: bytes from toggle to idle
net = {};
await toggleFlood();
await page.evaluate(() => { window.__m = window.__floodDebug.map; window.__floodAnim = 'off'; });
await sleep(6000);
console.log('LOAD-far', JSON.stringify(net));
net = {};
await page.evaluate(() => window.__floodDebug.flyToDistrict());
await page.evaluate(() => new Promise(r => { const m = window.__m; m.once('idle', r); setTimeout(r, 20000); }));
console.log('LOAD-bkk3d', JSON.stringify(Object.fromEntries(Object.entries(net).map(([k,v])=>[k,`${v.n} req ${v.kB.toFixed(0)} kB`]))));
await scenario('P1-pan-3d-flood-on-anim-off', pan);
await scenario('P2-static-3d-anim-10hz', async () => { await sleep(4000); await page.evaluate(() => { window.__floodAnim = '10hz'; window.__m.fire('moveend'); }); });
await page.evaluate(() => { window.__floodAnim = 'off'; window.__m.fire('moveend'); });
await toggleFlood();
await scenario('P3-pan-3d-flood-off', async () => { await sleep(4000); await pan(); });
await throttle(4);
await scenario('T1-4x-pan-3d-flood-off', async () => { await sleep(4000); await pan(); });
await toggleFlood();
await page.evaluate(() => { window.__floodAnim = 'off'; });
await scenario('T2-4x-pan-3d-flood-on-anim-off', async () => { await sleep(6000); await pan(); });
await scenario('T3-4x-static-3d-anim-10hz', async () => { await sleep(4000); await page.evaluate(() => { window.__floodAnim = '10hz'; window.__m.fire('moveend'); }); });
await scenario('T4-4x-static-3d-anim-off', async () => { await page.evaluate(() => { window.__floodAnim = 'off'; window.__m.fire('moveend'); }); await sleep(2000); });
await throttle(1);
writeFileSync(`${OUT}results2.json`, JSON.stringify({ results, errors: errors.slice(0, 40) }, null, 2));
console.log('ERRORS', errors.length, errors.slice(0, 15));
await browser.close();
