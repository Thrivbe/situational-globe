// OWNER: panels & UI worker. Entry point: page shell, side panel, tiles, worst-roads list, toggles, legend, header, 2D/3D switch.
// Builds toggles + legend from the LAYERS2D / LAYERS3D registries; never adds map layers itself.
import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.7.0/dist/maplibre-gl.mjs';
import { STYLE, BKK, CREDIT, FEEDS } from './feeds.js';
import { loadData, loadDistricts, esc, ago as agoRaw, hhmm, rainSummary, worst, bbox } from './data.js';
import { LAYERS2D, addLayers2D, mountTimeline } from './layers2d.js';
import { LAYERS3D, camera3d, addLayers3D, startOrbit } from './city3d.js';

// ponytail: worker must be same-origin; reuse the copy Osiris already commits. Serve the repo root.
maplibregl.setWorkerUrl('/public/vendor/maplibre/6.7.0/maplibre-gl-worker.mjs');

const ago = t => (Date.now() - t) < 90000 ? 'just now' : agoRaw(t);
const $ = id => document.getElementById(id);
const app = $('app');
const VIEWS = { A:'2D map', B:'3D city' };
const asked = (new URLSearchParams(location.search).get('variant') || 'A').toUpperCase();
const cur = VIEWS[asked] ? asked : 'A';
const LEVELS = ['blocked', 'risky', 'caution', 'ok'];
let curDists = null, curData = null, curMap = null, flyOpts = { padding:100, maxZoom:16 };

// ---- Thai / English: static labels only (numbers, road names and live sentences stay as they are) ----
const TH = {
  brand:'เฝ้าระวังน้ำท่วมกรุงเทพฯ', tag:'สถานการณ์ถนนและฝนแบบสด · ต้นแบบ', search:'ค้นหาเขตของคุณ', sources:'แหล่งข้อมูล',
  v_A:'แผนที่ 2 มิติ', v_B:'เมือง 3 มิติ', roads4:'ถนนสำหรับรถเก๋ง', blocked:'ผ่านไม่ได้', s_blocked:'ผ่านไม่ได้', s_risky:'เสี่ยง', s_caution:'ระวัง', s_ok:'ผ่านได้',
  moreRisky:'เสี่ยงเพิ่มอีก', tracked:'ช่วงถนนที่ติดตาม', rain:'ฝน', mmh:'มม./ชม.', now:'ตอนนี้', next6:'6 ชม.ข้างหน้า', peak:'โอกาสฝนสูงสุด 24 ชม.',
  worst:'ถนนที่แย่ที่สุด', clickZoom:'คลิกเพื่อซูม', clickFly:'คลิกเพื่อบิน', layers:'เลเยอร์', legend:'สัญลักษณ์', fresh:'ความสดของข้อมูล',
  t_districts:'เขตที่ควรเลี่ยง', t_deep:'น้ำลึกสุดที่รู้', t_reports:'รายงานสด', roadsH:'สถานะถนน', repH:'รายงานประชาชน', wxH:'พยากรณ์อากาศ', radH:'เรดาร์ฝน',
  disc:'ไม่ใช่คำเตือนอย่างเป็นทางการ โปรดใช้วิจารณญาณของคุณ', more:'เลเยอร์เพิ่มเติม', hudtog:'ซ่อน/แสดง', unnamedH:'ถนนไม่มีชื่อ', g_flood:'น้ำท่วม', g_rain:'ฝน', g_places:'สถานที่', g_transit:'ขนส่ง', g_other:'อื่น ๆ', near:'ใกล้ฉัน', t_river:'ระดับน้ำสูงสุด (% ตลิ่ง)', wx:'อากาศ', zoomHint:'ซูมออกเพื่อดูเขตและกลุ่มรายงาน', 'L_Danger hexes':'พื้นที่อันตราย', 'L_Canal and river level (% of bank)':'ระดับน้ำคลองและแม่น้ำ (% ตลิ่ง)',
  note:'ไม่ใช่คำเตือนอย่างเป็นทางการ ข้อมูลอาจไม่ครบ ตรวจสอบกับสำนักงานเขตหรือกรมอุตุนิยมวิทยา',
  'L_Flooded roads (for a sedan)':'ถนนน้ำท่วม (รถเก๋ง)', 'L_Live reports':'รายงานสด', 'L_Rain radar':'เรดาร์ฝน', 'L_Rain forecast (3x3 grid)':'พยากรณ์ฝน (กริด 3x3)',
  'L_District flood signals':'สัญญาณน้ำท่วมรายเขต', 'L_Hospitals (OSM)':'โรงพยาบาล (OSM)', 'L_Possible shelters (OSM, unofficial)':'จุดพักพิงที่เป็นไปได้ (OSM)',
  'L_Pumps and sluice gates (OSM)':'สถานีสูบน้ำและประตูน้ำ (OSM)', 'L_Fire and rescue stations (OSM)':'สถานีดับเพลิง (OSM)', 'L_Depth labels':'ป้ายความลึก',
  'L_Danger grid (derived cells)':'ตารางพื้นที่อันตราย', 'L_Rail and stations':'รถไฟและสถานี', 'L_Airports':'สนามบิน', 'L_Landmarks (OSM)':'สถานที่สำคัญ (OSM)',
  'L_Buildings':'อาคาร', 'L_Flooded roads':'ถนนน้ำท่วม', 'L_Depth columns':'แท่งความลึกน้ำ', 'L_District signals':'สัญญาณรายเขต', 'L_Hospitals':'โรงพยาบาล',
  'L_Shelters':'จุดพักพิง', 'L_Pumps and sluices':'สถานีสูบน้ำและประตูน้ำ', 'L_Parks':'สวนสาธารณะ',
};
let lang = 'en';
const EN = {};
function setLang(l) {
  lang = l; document.documentElement.lang = l;
  document.querySelectorAll('[data-t]').forEach(el => { const k = el.dataset.t; EN[k] ??= el.textContent; el.textContent = l === 'th' ? (TH[k] ?? EN[k]) : EN[k]; });
  document.querySelectorAll('[data-tp]').forEach(el => { const k = el.dataset.tp; EN[k] ??= el.placeholder; el.placeholder = l === 'th' ? (TH[k] ?? EN[k]) : EN[k]; });
  document.querySelectorAll('#lang button').forEach(b => b.classList.toggle('on', b.dataset.lg === l));
}

// One-line credit, never collapsed: every feed is named and linked; full licence text lives in the Sources popover.
const SHORT_CREDIT = '<a href="https://floodboard.org">Floodboard</a> · <a href="https://open-meteo.com/">Open-Meteo</a> · <a href="https://www.rainviewer.com">RainViewer</a> · '
  + '<a href="https://www.thaiwater.net">ThaiWater/HAII</a> (unconfirmed licence, prototype only)';
const makeMap = (container, opts = {}) => new maplibregl.Map({ container, style: STYLE, center: BKK, zoom: 10.6, maxPitch: 75,
  attributionControl: { compact: false, customAttribution: SHORT_CREDIT }, ...opts });

// One snapshot shared by the 2D and 3D views (10 min, per tab) so both show the same numbers and the same age.
async function snapshot() {
  try { const s = JSON.parse(sessionStorage.getItem('bkkflood.snap.v2')); if (s && Date.now() - s.t < 600000) return s.d; } catch {}
  const [d, wx2] = await Promise.all([loadData(), loadWx2()]);
  d.wx2 = wx2;
  try { sessionStorage.setItem('bkkflood.snap.v2', JSON.stringify({ t:Date.now(), d })); } catch {}
  return d;
}

// Current temperature, humidity, wind and UV from Open-Meteo (allowed feed; same host and licence as the forecast).
async function loadWx2() {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${BKK[1]}&longitude=${BKK[0]}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,uv_index&timezone=Asia/Bangkok`);
    if (!r.ok) throw new Error(r.status); return (await r.json()).current || null;
  } catch (e) { console.warn('weather extras unavailable:', e.message); return null; }
}
// ---- small formatters -------------------------------------------------------
const mm = v => (v >= 10 ? Math.round(v) : +v.toFixed(1));
const latestReport = d => Math.max(0, ...d.reports.features.map(f => Date.parse(f.properties.time) || 0));
function nextRain(wx) {
  const h = wx.hourly, i = h.time.findIndex(t => t >= wx.current.time.slice(0, 13));
  const j = h.precipitation.findIndex((v, k) => k > i && v >= 0.2);
  return j < 0 ? null : h.time[j].slice(11, 16);
}
const rainLine = (r, wx) => {
  if (r.now >= 0.2) return 'Raining now';
  const n = nextRain(wx);
  return n ? `Dry now, rain from ${n}` : 'Dry now, none forecast in 48 h';
};
const freshness = d => {
  const rep = latestReport(d), min = (Date.now() - d.updated) / 60000;
  return { roads: ago(d.updated), reports: rep ? ago(rep) : 'n/a', wx: d.wx.current.time.slice(11, 16),
    radar: d.frames.length ? hhmm(d.frames.findLast(f => !f.nowcast).time) : 'n/a', stale: min > 90 };
};

// ---- header: status, switch, language, sources, search ---------------------------
function paintStatus(d) {
  const f = freshness(d);
  $('status').innerHTML = `<span class="live ${f.stale ? 'stale' : ''}"></span><span>${f.stale ? 'Data is old' : 'Live'}</span>
    <span class="sep"></span><span class="dim">Roads updated <b>${f.roads}</b></span>
    <span class="sep"></span><span class="dim">Latest report <b>${f.reports}</b></span>`;
}
const keys = Object.keys(VIEWS), idx = keys.indexOf(cur);
const go = k => { const u = new URL(location); u.searchParams.set('variant', k); location.replace(u); };
$('switcher').innerHTML = keys.map(k => `<button data-k="${k}" data-t="v_${k}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${VIEWS[k]}</button>`).join('');
$('switcher').querySelectorAll('button').forEach(b => b.onclick = () => b.dataset.k !== cur && go(b.dataset.k));
addEventListener('keydown', e => { if (e.key === 'Escape') closeSources();
  if (e.target.closest?.('input,textarea,[contenteditable],button,li')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') go(keys[(idx + 1) % keys.length]); });
document.querySelectorAll('#lang button').forEach(b => b.onclick = () => setLang(b.dataset.lg));

const SRC = [
  ['Flood roads and reports', 'Floodboard', 'CC BY 4.0. Crowd and agency reports, may be incomplete.', FEEDS.floodRoads.url, ''],
  ['Weather forecast', 'Open-Meteo', 'CC BY 4.0, free tier is non-commercial.', FEEDS.forecast.url, ''],
  ['Rain radar', 'RainViewer', 'Free API, attribution required.', FEEDS.radar.url, ''],
  ['River and canal water level', 'ThaiWater / HAII', 'Unconfirmed licence, prototype only. % of bank from station levels.', FEEDS.waterLevel.url, 'prototype only'],
  ['Basemap and 3D buildings', 'OpenFreeMap / OpenStreetMap', 'Software MIT, data ODbL.', FEEDS.vectorTiles.url, ''],
  ['Hospitals, shelters, pumps, fire stations, districts, landmarks', 'OpenStreetMap contributors via Overpass', 'ODbL. Shelters are possible gathering sites, not an official list.', 'https://www.openstreetmap.org/copyright', ''],
];
function buildSources() {
  $('sources').innerHTML = `<h2>Sources and licences</h2><ul>${SRC.map(([what, who, lic, url, flag]) => `<li><b>${esc(what)}</b>
    <span>${esc(who)} · ${esc(lic)}${flag ? ` <em>${esc(flag)}</em>` : ''}</span></li>`).join('')}</ul>
    <p class="warn" data-t="note">This is not an official warning. Data may be incomplete or late. Check with your district office or the Thai Meteorological Department.</p>
    <p class="dim">Full credit text:</p><p class="credit">${CREDIT}</p>`;
}
function closeSources() { $('sources').hidden = true; $('srcbtn').setAttribute('aria-expanded', 'false'); }
$('srcbtn').onclick = e => { e.stopPropagation(); toggleSources(); };
const toggleSources = () => { const h = !$('sources').hidden; $('sources').hidden = h; $('srcbtn').setAttribute('aria-expanded', String(!h)); };
addEventListener('click', e => { if (e.target.closest('.srclink')) { e.stopPropagation(); toggleSources(); } else if (!e.target.closest('#sources,#srcbtn')) closeSources(); });
buildSources();

// District search: client-side filter over the district names (Nominatim is not an allowed feed).
function wireSearch(dists) {
  const list = dists.polys.features;
  $('dlist').innerHTML = list.flatMap(f => [f.properties.name, f.properties.nameTh].filter(Boolean)).map(n => `<option value="${esc(n)}">`).join('');
  const jump = () => {
    const q = $('find').value.trim().toLowerCase(); if (!q || !curMap) return;
    const hit = list.find(f => [f.properties.name, f.properties.nameTh].some(n => n?.toLowerCase() === q))
      || list.find(f => [f.properties.name, f.properties.nameTh].some(n => n?.toLowerCase().includes(q)));
    $('find').classList.toggle('nomatch', !hit);
    if (hit) curMap.fitBounds(bbox(hit.geometry), { ...flyOpts, maxZoom:13.5 });
  };
  $('find').onchange = jump; $('find').onkeydown = e => { if (e.key === 'Enter') jump(); };
}

// ---- shared blocks ------------------------------------------------------------
const swatch = i => `<i class="lg ${i.shape}" style="background:${i.color}"></i>`;
// The 3D registry gives radar no legend: show the intensity scale from here so the group is not blank.
const FALLBACK = { radar:[{ shape:'swatch', color:'#88ddee', label:'light rain' }, { shape:'swatch', color:'#0077ee', label:'moderate' }, { shape:'swatch', color:'#ffaa00', label:'heavy' }] };
const legendOf = l => l.legend.length ? l.legend : (FALLBACK[l.key] || []);
const lname = l => `data-t="${esc('L_' + l.label)}"`;
// Layer chips: the main four always visible, the rest grouped (Flood / Rain / Places / Transit) under a "More layers" fold.
const MAIN = { A:['roads','reports','districts','radar'], B:['buildings','roads','danger','reports','radar'] };
const GROUPS = [['Flood','g_flood',['roads','reports','depth','danger','districts','buildings']], ['Rain','g_rain',['radar','raingrid']],
  ['Places','g_places',['hospitals','shelters','pumping','fire','landmarks','parks']], ['Transit','g_transit',['rail','airports']]];
const chip = (l, d) => `<label class="tchip"><input type="checkbox" data-l="${esc(l.ids.join(','))}" data-k="${l.key}" checked>
    <i class="lg ${legendOf(l)[0]?.shape || 'swatch'}" style="background:${legendOf(l)[0]?.color || 'var(--dim)'}"></i><span class="nm" ${lname(l)}>${esc(l.label)}</span>${l.count ? `<span class="ct">${l.count(d)}</span>` : ''}</label>`;
function togglesHTML(reg, d) {
  const main = MAIN[cur], ord = [...reg.filter(l => main.includes(l.key)), ...reg.filter(l => !main.includes(l.key))];
  return `<div class="tchips all">${ord.map(l => chip(l, d)).join('')}</div>`;
}
const legendHTML = reg => `<div class="legend">${reg.map(l => `<div class="lrow" data-k="${l.key}"><span class="lt" ${lname(l)}>${esc(l.label)}</span>
    <span class="chips">${legendOf(l).map(i => `<span>${swatch(i)}${esc(i.label)}</span>`).join('')}</span></div>`).join('')}</div>`;
// Legend rows follow the toggles: only layers that are ON (and available) are listed.
function syncLegend() {
  app.querySelectorAll('input[data-k]').forEach(cb => app.querySelectorAll(`.lrow[data-k="${cb.dataset.k}"]`).forEach(r => r.classList.toggle('off', !cb.checked || cb.disabled)));
}
function wireToggles(map) {
  app.querySelectorAll('input[data-l]').forEach(cb => cb.onchange = () => {
    cb.dataset.l.split(',').forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', cb.checked ? 'visible' : 'none'));
    syncLegend();
  });
  new MutationObserver(syncLegend).observe(app, { subtree:true, attributes:true, attributeFilter:['disabled'] });
  syncLegend();
}
const sevBar = d => { const total = LEVELS.reduce((a, k) => a + d.counts[k], 0) || 1;
  return `<div class="sevbar" role="img" aria-label="Road status split">${LEVELS.map(k => `<i style="flex:${d.counts[k]};background:var(--${k})" title="${k}: ${d.counts[k]}"></i>`).join('')}</div>
  <div class="sevkey">${LEVELS.map(k => `<div><b style="color:var(--${k})">${d.counts[k]}</b><span data-t="s_${k}">${k === 'ok' ? 'Passable' : k[0].toUpperCase() + k.slice(1)}</span></div>`).join('')}</div>
  <div class="dim tot"><span>${total}</span> <span data-t="tracked">road segments tracked</span></div>`; };
const DISC = `<p class="disc"><span data-t="disc">Not an official warning. Use your own judgement.</span> <button type="button" class="srclink lnk" data-t="sources">Sources</button></p>`;
const rainStats = (r, wx) => `<div class="rainhead">${esc(rainLine(r, wx))}</div>
  <div class="stats3"><div><b>${mm(r.now)}<small data-t="mmh"> mm/h</small></b><span data-t="now">now</span></div>
  <div><b>${mm(r.next6)}<small> mm</small></b><span data-t="next6">next 6 h</span></div>
  <div><b>${r.maxP}<small>%</small></b><span data-t="peak">peak chance, 24 h</span></div></div>`;

const wxRow = d => { const c = d.wx2; if (!c) return '<p class="dim wxrow">Temperature, wind and UV unavailable</p>';
  const v = (x, u) => Number.isFinite(x) ? `${Math.round(x * 10) / 10}${u}` : 'n/a';
  return `<div class="wxrow"><span><b>${v(c.temperature_2m, '°C')}</b> ${v(c.relative_humidity_2m, '%')} humid</span><span><b>${v(c.wind_speed_10m, '')}</b> km/h wind</span><span>UV <b>${v(c.uv_index, '')}</b></span></div>`; };
// Worst river or canal station, as % of bank.
function river(d) {
  let b = null; for (const f of d.water?.features || []) if (f.properties.pct >= 0 && (!b || f.properties.pct > b.pct)) b = f.properties;
  return b;
}
const riverTile = d => { const r = river(d); return `<div><b>${r ? r.pct + '<small>%</small>' : 'n/a'}</b><span><span data-t="t_river">river, % of bank</span>${r ? ` · ${esc(r.name)}` : ''}</span></div>`; };

// Worst roads, grouped by road name: one row per road, with its segment counts, deepest known depth and report age.
function groupRoads(d) {
  const m = new Map();
  for (const f of worst(d)) {
    const p = f.properties, g = m.get(p.label) || { label:p.label, sev:0, n4:0, n3:0, n2:0, depth:0, upd:0, feats:[] };
    g.sev = Math.max(g.sev, p.sev); g[`n${p.sev}`]++; g.depth = Math.max(g.depth, p.depthCm || 0); g.upd = Math.max(g.upd, +p.updated || 0); g.feats.push(f);
    m.set(p.label, g);
  }
  return [...m.values()].map(g => {
    const hot = g.feats.filter(f => f.properties.sev >= g.sev), bs = hot.map(f => bbox(f.geometry));
    const u = [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))];
    // A road name spread over the whole city (unnamed roads, long avenues): fly to its deepest segment, not a city-wide box.
    const top = hot.reduce((a, f) => (f.properties.depthCm || 0) > (a.properties.depthCm || 0) ? f : a, hot[0]);
    return { ...g, sedan: ['', 'ok', 'caution', 'risky', 'blocked'][g.sev], box: (u[2] - u[0] > .12 || u[3] - u[1] > .12) ? bbox(top.geometry) : u };
  }).sort((a, b) => b.sev - a.sev || (b.depth > 0) - (a.depth > 0) || b.depth - a.depth || (b.n4 + b.n3) - (a.n4 + a.n3) || b.n2 - a.n2);
}
const segText = g => [g.n4 && `${g.n4} blocked`, g.n3 && `${g.n3} risky`, g.n2 && `${g.n2} caution`].filter(Boolean).join(', ') + (g.n4 + g.n3 + g.n2 === 1 ? ' segment' : ' segments');
const isUnnamed = g => /^unnamed/i.test(g.label);
const roadRow = (g, i) => `<li tabindex="0" data-i="${i}" style="--c:var(--${g.sedan})">
  <span class="rk">${i + 1}</span><span class="rn"><b title="${esc(g.label)}">${esc(g.label)}</b>
  <span class="dim">${segText(g)}${g.depth ? ` · deepest ${g.depth} cm` : ''}${g.upd ? ` · ${ago(g.upd)}` : ''}</span></span><span class="pill ${g.sedan}">${g.sedan}</span></li>`;
// Named roads first (they are what a person can act on); unnamed ones collapse into one summary row that expands on demand.
function roadsBlock(list, max) {
  const named = list.map((g, i) => [g, i]).filter(([g]) => !isUnnamed(g)).slice(0, max), un = list.map((g, i) => [g, i]).filter(([g]) => isUnnamed(g));
  const n4 = un.reduce((a, [g]) => a + g.n4, 0), n3 = un.reduce((a, [g]) => a + g.n3, 0);
  const sum = un.length && (n4 + n3) ? `<li class="unsum"><button type="button" class="unbtn" aria-expanded="false"><span><span data-t="unnamedH">Unnamed roads</span>: <b>${n4}</b> blocked, <b>${n3}</b> risky segments</span><span class="car">Show</span></button></li>` : '';
  return `<ol class="roads">${named.map(([g, i]) => roadRow(g, i)).join('')}${sum}</ol>${sum ? `<ol class="roads unlist" hidden>${un.slice(0, 15).map(([g, i]) => roadRow(g, i)).join('')}</ol>` : ''}`;
}
function wireRoads(map, list, opts) {
  flyOpts = opts;
  app.querySelectorAll('.unbtn').forEach(b => b.onclick = () => { const u = app.querySelector('.unlist'), h = !u.hidden; u.hidden = h; b.setAttribute('aria-expanded', String(!h)); b.querySelector('.car').textContent = h ? 'Show' : 'Hide'; });
  const fly = li => map.fitBounds(list[+li.dataset.i].box, opts);
  app.querySelectorAll('li[data-i]').forEach(li => { li.onclick = () => fly(li);
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fly(li); } }; });
}
const dataRows = d => { const f = freshness(d); return `<dl class="fresh">
  <dt data-t="roadsH">Road status</dt><dd>${f.roads}</dd><dt data-t="repH">Citizen reports</dt><dd>latest ${f.reports}</dd>
  <dt data-t="wxH">Weather forecast</dt><dd>issued ${f.wx} Bangkok</dd><dt data-t="radH">Rain radar</dt><dd>frame ${f.radar} Bangkok</dd></dl>`; };

// Deepest known water: roads with a stated depth and open reports.
function deepest(d) {
  let best = { cm:0, where:'' };
  for (const f of d.roads.features) if ((f.properties.depthCm || 0) > best.cm) best = { cm:f.properties.depthCm, where:f.properties.label };
  for (const f of d.reports.features) if (f.properties.depth > best.cm) best = { cm:f.properties.depth, where:'citizen report' };
  return best;
}
// District headline, filled when the (lazy, shared) district polygons arrive. >= 12 signals = avoid, 1-11 = watch (same bands as the map).
function paintDistricts(dists) {
  const el = $('dsum'); if (!el) return;
  if (!dists) { el.innerHTML = '<span class="dim">District summary unavailable (map data feed offline)</span>'; return; }
  curDists = dists;
  const ps = dists.polys.features.map(f => f.properties).sort((a, b) => b.signals - a.signals);
  const avoid = ps.filter(p => p.signals >= 12).length, watch = ps.filter(p => p.signals >= 1 && p.signals < 12).length;
  if ($('t-dist')) $('t-dist').textContent = avoid;
  el.innerHTML = ps[0] && ps[0].signals ? `${watch} to watch. Worst: <b>${esc(ps[0].name)}</b> (${ps[0].signals} signals).` : 'No district shows flood signals right now.';
}

// ---- 2D -----------------------------------------------------------------------
function View2D(d) {
  const r = rainSummary(d.wx), list = groupRoads(d), dp = deepest(d);
  app.innerHTML = `<div class="a"><aside>
    <section class="top"><h2><span data-t="roads4">Roads for a sedan</span></h2>
      <div class="hero"><b style="color:var(--blocked)">${d.counts.blocked}</b><span><span data-t="blocked">blocked</span><br><em>${d.counts.risky} <span data-t="moreRisky">more risky</span></em></span></div>
      ${sevBar(d)}
      ${DISC}
      <div class="tiles tiles4"><div><b id="t-dist">…</b><span data-t="t_districts">districts to avoid</span></div>
        <div><b>${dp.cm ? dp.cm + '<small> cm</small>' : 'n/a'}</b><span data-t="t_deep">deepest known</span></div>
        <div><b>${d.reports.features.length}</b><span data-t="t_reports">live reports</span></div>${riverTile(d)}</div>
      <p id="dsum" class="dsum dim">Reading district boundaries…</p></section>
    <section><h2 data-t="rain">Rain</h2>${rainStats(r, d.wx)}${wxRow(d)}</section>
    <section class="lay"><h2 data-t="layers">Layers</h2>${togglesHTML(LAYERS2D, d)}</section>
    <section class="roadsec"><h2><span data-t="worst">Worst roads now</span> <span class="hint"><span>${list.length} roads · </span><span data-t="clickZoom">click to zoom</span></span></h2><div class="rscroll">${roadsBlock(list, 25)}</div></section>
    <details class="freshd"><summary data-t="fresh">Data freshness</summary>${dataRows(d)}<p class="note" data-t="note">This is not an official warning. Data may be incomplete or late. Check with your district office or the Thai Meteorological Department.</p></details>
  </aside><div class="mapwrap"><div class="mapbox"><div id="m" class="map"></div><details class="maplegend"><summary data-t="legend">Legend</summary>${legendHTML(LAYERS2D)}</details></div><footer id="timeline" class="timeline"></footer></div></div>`;
  const map = curMap = makeMap('m');
  // Auto-collapse the legend when a popup opens so it never hides popup text.
  new MutationObserver(() => { if (document.querySelector('#m .maplibregl-popup')) app.querySelector('.maplegend')?.removeAttribute('open'); }).observe($('m'), { childList:true, subtree:true });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.once('style.load', () => { addLayers2D(map, d); mountTimeline(document.getElementById('timeline'), map, d); });
  wireRoads(map, list, { padding:120, maxZoom:16 });
  wireToggles(map);
  return map;
}

// ---- 3D -----------------------------------------------------------------------
function View3D(d) {
  const r = rainSummary(d.wx), list = groupRoads(d), dp = deepest(d);
  app.innerHTML = `<div id="m" class="map"></div>
    <div class="hud"><button type="button" id="hudtog" class="hudtog" aria-expanded="true" aria-label="Collapse panel" title="Collapse panel">&minus;</button>
      <div class="hero"><b style="color:var(--blocked)">${d.counts.blocked}</b><span><span data-t="blocked">roads blocked</span><br><em>${d.counts.risky} risky · ${d.counts.caution} caution</em></span></div>
      ${DISC}
      <div class="hudbody">
      <div class="tiles tiles4"><div><b id="t-dist">…</b><span data-t="t_districts">districts to avoid</span></div>
        <div><b>${dp.cm ? dp.cm + '<small> cm</small>' : 'n/a'}</b><span><span data-t="t_deep">deepest known</span>${dp.where && dp.where !== 'citizen report' ? ' · ' + esc(dp.where) : ''}</span></div>
        <div><b>${d.reports.features.length}</b><span data-t="t_reports">live reports</span></div>${riverTile(d)}</div>
      <p id="dsum" class="dsum dim">Reading district boundaries…</p>
      <div class="hudrain">${rainStats(r, d.wx)}${wxRow(d)}</div>
      <h2 data-t="layers">Layers</h2>${togglesHTML(LAYERS3D, d)}<p class="zhint" data-t="zoomHint">Zoom out for districts and clusters</p>
      <h2><span data-t="worst">Worst roads</span> <span class="hint" data-t="clickFly">click to fly</span></h2>${roadsBlock(list, 3)}
      </div></div><details class="maplegend"><summary data-t="legend">Legend</summary>${legendHTML(LAYERS3D)}</details>`;
  $('hudtog').onclick = () => { const c = app.querySelector('.hud').classList.toggle('collapsed'); $('hudtog').setAttribute('aria-expanded', String(!c)); $('hudtog').innerHTML = c ? '+' : '&minus;'; curMap.setPadding({ left: c ? 0 : 380, top:0, right:0, bottom:0 }); };
  const map = curMap = makeMap('m', camera3d(d));
  map.once('style.load', () => map.setPadding({ left:380, top:0, right:0, bottom:0 }));
  map.addControl(new maplibregl.NavigationControl({ visualizePitch:true }), 'top-right');
  map.once('style.load', () => { addLayers3D(map, d); startOrbit(map); });
  wireRoads(map, list, { padding:80, maxZoom:15.5, pitch:62 });
  wireToggles(map);
  return map;
}

// ---- Near me: browser geolocation, then nearest blocked/risky roads, reports and district status within 3 km (from the loaded snapshot) ----
const hav = (a, b) => { const r = x => x * Math.PI / 180, dl = r(b[1] - a[1]), dn = r(b[0] - a[0]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const pts = g => g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates.flat() : [];
const inRing = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j];
  if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const inGeom = (p, g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).some(poly => inRing(p, poly[0]) && !poly.slice(1).some(h => inRing(p, h)));
let nearMarker = null;
function nearReport(at, d) {
  const km = f => Math.min(...pts(f.geometry).map(q => hav(at, q)));
  const roads = new Map();
  for (const f of d.roads.features) { if (f.properties.sev < 3) continue; const k = km(f); if (k > 3) continue;
    const o = roads.get(f.properties.label); if (!o || k < o.km) roads.set(f.properties.label, { label:f.properties.label, sev:f.properties.sev, km:k }); }
  const rl = [...roads.values()].sort((a, b) => b.sev - a.sev || a.km - b.km), nrep = d.reports.features.filter(f => km(f) <= 3).length;
  const dist = curDists?.polys.features.find(f => inGeom(at, f.geometry))?.properties;
  const dstat = !curDists ? 'District boundaries not loaded' : !dist ? 'Not inside a known district' : dist.signals >= 12 ? `${esc(dist.name)}: avoid (${dist.signals} signals)` : dist.signals ? `${esc(dist.name)}: watch (${dist.signals} signals)` : `${esc(dist.name)}: no flood signals`;
  return `<h2><span>Within 3 km of you</span><button type="button" class="lnk" id="nearx">Close</button></h2><p class="dsum"><b>${esc(dstat)}</b></p>
    <p class="dsum"><b>${rl.filter(r => r.sev === 4).length}</b> blocked, <b>${rl.filter(r => r.sev === 3).length}</b> risky roads · <b>${nrep}</b> live reports</p>
    <ul class="nlist">${rl.slice(0, 5).map(r => `<li><span class="pill ${r.sev === 4 ? 'blocked' : 'risky'}">${r.sev === 4 ? 'blocked' : 'risky'}</span> ${esc(r.label)} <span class="dim">${r.km.toFixed(1)} km</span></li>`).join('') || '<li class="dim">No blocked or risky roads within 3 km.</li>'}</ul>`;
}
function nearMe() {
  const card = $('near'); card.hidden = false; card.innerHTML = '<p class="dsum dim">Finding your location…</p>';
  const fail = m => { card.innerHTML = `<p class="dsum">${m}</p><button type="button" class="lnk" id="nearx">Close</button>`; $('nearx').onclick = () => card.hidden = true; };
  if (!navigator.geolocation) return fail('This browser has no location access. Use the district search instead.');
  navigator.geolocation.getCurrentPosition(pos => {
    const at = [pos.coords.longitude, pos.coords.latitude];
    if (hav(at, BKK) > 60) return fail('You appear to be outside the Bangkok area. Use the district search instead.');
    card.innerHTML = nearReport(at, curData); $('nearx').onclick = () => card.hidden = true;
    nearMarker?.remove(); nearMarker = new maplibregl.Marker({ color:'#38bdf8' }).setLngLat(at).addTo(curMap);
    curMap.flyTo({ center:at, zoom:13.2 });
  }, err => fail(err.code === 1 ? 'Location permission was denied. Allow it in the browser, or use the district search instead.' : 'Could not get your location. Use the district search instead.'), { timeout:10000, maximumAge:60000 });
}
$('nearbtn').onclick = e => { e.stopPropagation(); nearMe(); };

snapshot().then(d => { curData = d; paintStatus(d); window.__map = (cur === 'B' ? View3D : View2D)(d); window.__data = d; setLang(lang);
  loadDistricts(d).then(x => { paintDistricts(x); if (x) wireSearch(x); setLang(lang); }); })
  .catch(err => { app.innerHTML = `<div class="loading">Could not load live data: ${esc(err.message)}</div>`; console.error(err); });
