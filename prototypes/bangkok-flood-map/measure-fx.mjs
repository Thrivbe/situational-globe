import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '/Users/robinsverd/Thrivbe-AI/Thrivbe-OS/skills/research/website-crawler/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ executablePath: '/Users/robinsverd/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium', headless: process.env.HEADED !== '1', args: ['--enable-gpu','--ignore-gpu-blocklist','--use-angle=metal','--enable-precise-memory-info'] });

const BASE_URL = process.env.URL_ || 'http://127.0.0.1:8791/prototypes/bangkok-flood-map/?variant=B&orbit=0';
const OUT_DIR = new URL('./fx-shots/', import.meta.url);
const RESULT_FILE = new URL(`./${process.env.OUT_ || 'fx-results.json'}`, import.meta.url);
const EFFECTS = ['shadows-fake', 'water-sheen', 'glow-plus', 'water-ripple', 'glow-pulse', 'bloom-real', 'shadows-real', 'water-shader'];
const ANIMATED = ['water-ripple', 'glow-pulse', 'water-shader'];
// Singles: 'none' = no fx effect and the old 3D loop off too, so each row is that effect's own cost.
// still+off = cost when nothing moves; 10hz = cost of animating it; panning+off = extra cost per frame while the camera moves.
const cases = [
  ...[0, 1, 2, 3].map(pack => ({ name:`pack-${pack}-still`, pack })),
  { name:'none-still-off', pack:0, on:'none', anim:'off' },
  ...EFFECTS.map(effect => ({ name:`only-${effect}-still-off`, pack:0, on:effect, anim:'off' })),
  ...ANIMATED.map(effect => ({ name:`only-${effect}-10hz`, pack:0, on:effect, anim:'10hz' })),
  { name:'none-10hz', pack:0, on:'none', anim:'10hz' },
  { name:'only-glow-pulse-10hz-fade', pack:0, on:'glow-pulse', anim:'10hz', fade:true },
  { name:'none-panning', pack:0, on:'none', anim:'off', pan:true },
  ...EFFECTS.map(effect => ({ name:`only-${effect}-panning`, pack:0, on:effect, anim:'off', pan:true })),
  { name:'pack-1-panning', pack:1, pan:true },
  { name:'pack-3-panning', pack:3, pan:true },
  { name:'pack-0-still-cpu4x', pack:0, cpu:4 },
  { name:'pack-3-still-cpu4x', pack:3, cpu:4 },
].filter(test => !process.env.CASES || new RegExp(process.env.CASES).test(test.name));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const metricsMap = result => Object.fromEntries(result.metrics.map(metric => [metric.name, metric.value]));
const caseUrl = test => {
  const url = new URL(BASE_URL); url.searchParams.set('variant', 'B'); url.searchParams.set('orbit', '0'); url.searchParams.set('fx', String(test.pack));
  if (test.on) url.searchParams.set('on', test.on); else url.searchParams.delete('on');
  if (test.anim) url.searchParams.set('anim', test.anim); else url.searchParams.delete('anim');
  if (test.fade) url.searchParams.set('fade', '1');
  return url.href;
};

async function waitForIdle(page) {
  await page.waitForFunction(() => window.__map && window.__fx, null, { timeout:120000 });
  await page.evaluate(() => new Promise(resolve => {
    const finish = () => resolve();
    window.__fx.anim('off'); window.__map.once('idle', finish); window.__map.triggerRepaint(); setTimeout(finish, 20000);
  }));
}

async function panFor(page, ms) {
  await page.evaluate(duration => new Promise(resolve => {
    const map = window.__map, started = performance.now(); let direction = 1;
    const step = () => {
      if (performance.now() - started >= duration) { map.stop(); resolve(); return; }
      map.panBy([direction * 12, 0], { duration:110, essential:true }); direction *= -1; setTimeout(step, 110);
    };
    step();
  }), ms);
}

await mkdir(OUT_DIR, { recursive:true });
const rows = [];
try {
  for (const test of cases) {
    const page = await browser.newPage({ viewport:{ width:1440, height:900 }, deviceScaleFactor:1 });
    const errors = [];
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    const cdp = await page.context().newCDPSession(page);
    let row = { case:test.name, url:caseUrl(test) };
    try {
      await cdp.send('Performance.enable');
      if (test.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate:test.cpu });
      await page.goto(row.url, { waitUntil:'domcontentloaded', timeout:120000 });
      await waitForIdle(page);
      const desiredMode = test.anim || ({ 0:'raf', 1:'move', 2:'10hz', 3:'raf' })[test.pack];
      await page.evaluate(value => window.__fx.anim(value), desiredMode); await delay(6000);
      const before = metricsMap(await cdp.send('Performance.getMetrics'));
      const started = performance.now();
      if (test.pan) await panFor(page, 8000); else await delay(8000);
      const elapsed = (performance.now() - started) / 1000;
      const after = metricsMap(await cdp.send('Performance.getMetrics'));
      const fx = await page.evaluate(() => window.__fx.stats());
      row = { ...row, elapsedSeconds:elapsed,
        mainThreadBusyPct:100 * ((after.TaskDuration || 0) - (before.TaskDuration || 0)) / elapsed,
        scriptPct:100 * ((after.ScriptDuration || 0) - (before.ScriptDuration || 0)) / elapsed,
        ...fx, errors };
    } catch (error) {
      errors.push(`measure: ${error.stack || error.message}`); row.errors = errors;
    }
    try { await page.screenshot({ path:new URL(`${test.name}.jpg`, OUT_DIR).pathname, type:'jpeg', quality:86 }); }
    catch (error) { errors.push(`screenshot: ${error.message}`); }
    rows.push(row); await page.close();
  }
} finally {
  await browser.close();
}

await writeFile(RESULT_FILE, `${JSON.stringify({ generatedAt:new Date().toISOString(), baseUrl:BASE_URL, rows }, null, 2)}\n`);
const value = (number, digits = 1) => Number.isFinite(number) ? number.toFixed(digits) : 'n/a';
console.log('| Case | Busy % | Script % | fps | p95 ms | Repaints/s | three ms | Shadow ms | Osiris rough % | Errors |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const row of rows) console.log(`| ${row.case} | ${value(row.mainThreadBusyPct)} | ${value(row.scriptPct)} | ${value(row.fps)} | ${value(row.p95FrameMs)} | ${value(row.repaintsPerSec)} | ${value(row.threeMsPerFrame, 2)} | ${value(row.shadowRebuildMs)} | ${value(row.osirisMainThreadPct)} | ${row.errors?.length || 0} |`);
