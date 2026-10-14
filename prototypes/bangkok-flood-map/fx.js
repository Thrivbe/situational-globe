// Throwaway game-like effects lab for variant B. MapLibre effects stay dependency-free;
// fx3d.js (and therefore three.js) is imported only after a three.js toggle is enabled.

const EFFECTS = [
  ['shadows-fake', 'Fake building shadows', 'map'],
  ['water-sheen', 'Flood water sheen', 'map'],
  ['glow-plus', 'Stronger fake glow', 'map'],
  ['water-ripple', 'Moving water', 'map'],
  ['glow-pulse', 'Animated neon pulse', 'map'],
  ['bloom-real', 'Real bloom', 'three'],
  ['shadows-real', 'Real cast shadows', 'three'],
  ['water-shader', 'Shader water', 'three'],
];
const KEYS = EFFECTS.map(([key]) => key);
const THREE_KEYS = new Set(EFFECTS.filter(([, , kind]) => kind === 'three').map(([key]) => key));
const PACKS = {
  0: { label:'Today', anim:'raf', on:[] },
  1: { label:'MapLibre still', anim:'move', on:['shadows-fake', 'water-sheen', 'glow-plus'] },
  2: { label:'MapLibre alive', anim:'10hz', on:['shadows-fake', 'water-sheen', 'glow-plus', 'water-ripple', 'glow-pulse'] },
  3: { label:'three.js game', anim:'raf', on:['bloom-real', 'shadows-real', 'water-shader', 'water-sheen'] },
};
const MODES = new Set(['off', 'move', '10hz', 'raf']);
const ZI = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const HOT = ['>=', ['get', 'sev'], 3];
const CAP = { 'line-cap':'round', 'line-join':'round' };
const RIPPLE_DASH = [[.5, 2.5, 1, 3], [1, 2, 1, 3], [1.5, 1.5, 1, 3], [2, 1, 1, 3], [1.5, 1, 1.5, 2.5], [1, 1, 2, 2.5]];

const MAP_LAYERS = {
  'shadows-fake':['fx-shadows-fake'],
  'water-sheen':['fx-water-sheen-fill', 'fx-water-sheen-edge'],
  'glow-plus':['fx-glow-plus-wide', 'fx-glow-plus-mid', 'fx-glow-plus-columns'],
  'water-ripple':['fx-water-ripple-bed', 'fx-water-ripple-crest'],
};

function addBefore(map, layer, before) {
  if (map.getLayer(layer.id)) return;
  map.addLayer(layer, before && map.getLayer(before) ? before : undefined);
}

function removeLayers(map, ids = []) {
  for (const id of [...ids].reverse()) if (map.getLayer(id)) map.removeLayer(id);
}

function addMapEffect(map, key) {
  if (key === 'shadows-fake') {
    // Ceiling: this is a screen-readable offset silhouette; its length follows zoom, not each building's height.
    addBefore(map, { id:'fx-shadows-fake', type:'fill', source:'openmaptiles', 'source-layer':'building', minzoom:13.9,
      paint:{ 'fill-color':'#01030a', 'fill-opacity':.55,
        'fill-translate':ZI(12, ['literal',[2, 3]], 14, ['literal',[8, 12]], 17, ['literal',[28, 42]]), 'fill-translate-anchor':'map' } }, 'bld3d');
  }
  if (key === 'water-sheen') {
    addBefore(map, { id:'fx-water-sheen-fill', type:'line', source:'roads', filter:HOT, layout:CAP,
      paint:{ 'line-color':'#087bd8', 'line-width':ZI(10, 10, 14, 38, 17, 82), 'line-blur':ZI(10, 2, 14, 7, 17, 16), 'line-opacity':.3 } }, 'roads-water');
    addBefore(map, { id:'fx-water-sheen-edge', type:'line', source:'roads', filter:HOT, layout:CAP,
      paint:{ 'line-color':'#9de8ff', 'line-width':ZI(10, .8, 14, 2.2, 17, 5), 'line-blur':.5, 'line-opacity':.62,
        'line-translate':[0, -2], 'line-translate-anchor':'viewport' } }, 'roads-water');
  }
  if (key === 'glow-plus') {
    addBefore(map, { id:'fx-glow-plus-wide', type:'line', source:'roads', filter:HOT, layout:CAP,
      paint:{ 'line-color':'#1679ff', 'line-width':ZI(10, 18, 14, 52, 17, 108), 'line-blur':ZI(10, 13, 14, 30, 17, 58), 'line-opacity':.18 } }, 'roads-water');
    addBefore(map, { id:'fx-glow-plus-mid', type:'line', source:'roads', filter:HOT, layout:CAP,
      paint:{ 'line-color':['match', ['get','sedan'], 'blocked','#ff244f', 'risky','#ff982b', '#2f7fe0'],
        'line-width':ZI(10, 9, 14, 27, 17, 55), 'line-blur':ZI(10, 7, 14, 16, 17, 30), 'line-opacity':.24 } }, 'roads-water');
    addBefore(map, { id:'fx-glow-plus-columns', type:'circle', source:'report-pts', filter:['!', ['has','point_count']], minzoom:12.5,
      paint:{ 'circle-pitch-alignment':'map', 'circle-radius':ZI(12, 11, 14, 30, 17, 105),
        'circle-color':['case', ['get','closed'], '#ff1744', '#31b9ff'], 'circle-blur':1, 'circle-opacity':.28 } }, 'reports-glow');
  }
  if (key === 'water-ripple') {
    addBefore(map, { id:'fx-water-ripple-bed', type:'line', source:'roads', filter:HOT, layout:CAP,
      paint:{ 'line-color':'#168eea', 'line-width':ZI(10, 8, 14, 29, 17, 64), 'line-blur':ZI(10, 2, 14, 8, 17, 14),
        'line-opacity':.22, 'line-dasharray':RIPPLE_DASH[0] } }, 'roads-water');
    addBefore(map, { id:'fx-water-ripple-crest', type:'line', source:'roads', filter:HOT, layout:CAP,
      paint:{ 'line-color':'#c7f3ff', 'line-width':ZI(10, .7, 14, 1.8, 17, 4), 'line-blur':.7,
        'line-opacity':.65, 'line-dasharray':RIPPLE_DASH[0] } }, 'roads-water');
  }
}

function resetGlowPulse(map) {
  if (map.getLayer('roads-halo')) {
    map.setPaintProperty('roads-halo', 'line-opacity', .75);
    map.setPaintProperty('roads-halo', 'line-width', ZI(10, 5, 14, 16, 17, 32));
  }
  if (map.getLayer('roads-glow')) {
    map.setPaintProperty('roads-glow', 'line-opacity', .95);
    map.setPaintProperty('roads-glow', 'line-width', ZI(10, 2.5, 14, 6, 17, 12));
  }
}

function panelMarkup(pack, mode, enabled) {
  const options = Object.entries(PACKS).map(([n, p]) => `<option value="${n}"${+n === pack ? ' selected' : ''}>${n} · ${p.label}</option>`).join('');
  const clocks = [['off','off'], ['move','while moving'], ['10hz','10 Hz'], ['raf','rAF']]
    .map(([value, label]) => `<option value="${value}"${value === mode ? ' selected' : ''}>${label}</option>`).join('');
  const group = kind => EFFECTS.filter(([, , k]) => k === kind).map(([key, label]) =>
    `<label><input type="checkbox" data-fx-key="${key}"${enabled.has(key) ? ' checked' : ''}> <span>${label}</span></label>`).join('');
  return `<div class="fx-title"><b>FX LAB</b><span id="fx-three-state">three.js: no</span></div>
    <label class="fx-row">Pack <select id="fx-pack">${options}</select></label>
    <label class="fx-row">Animate <select id="fx-anim">${clocks}</select></label>
    <fieldset><legend>MapLibre only</legend>${group('map')}</fieldset>
    <fieldset><legend>three.js</legend>${group('three')}</fieldset>
    <div class="fx-metrics" id="fx-metrics">warming up…</div>`;
}

function mountPanel(map, pack, mode, enabled) {
  if (!document.getElementById('fx-panel-style')) {
    const style = document.createElement('style');
    style.id = 'fx-panel-style';
    style.textContent = `#fx-panel{position:fixed;left:392px;bottom:52px;z-index:20;width:318px;max-height:calc(100vh - 120px);overflow:auto;box-sizing:border-box;padding:10px 12px;border:1px solid #28759b;border-radius:8px;background:rgba(4,11,20,.94);color:#dff7ff;box-shadow:0 8px 30px #000a;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}#fx-panel .fx-title{display:flex;justify-content:space-between;color:#5ee7ff;margin-bottom:7px}#fx-panel .fx-row{display:grid;grid-template-columns:64px 1fr;align-items:center;margin:4px 0}#fx-panel select{min-width:0;background:#0c1a29;color:#e8f8ff;border:1px solid #35516b;border-radius:3px;font:inherit;padding:2px}#fx-panel fieldset{display:grid;grid-template-columns:1fr;border:0;border-top:1px solid #233c50;margin:7px 0 0;padding:5px 0 0}#fx-panel legend{padding:0 6px 0 0;color:#7fa8bd}#fx-panel fieldset label{display:flex;gap:3px;align-items:center;padding:1px 0}#fx-panel input{accent-color:#26c6ff}.fx-metrics{margin-top:7px;padding-top:7px;border-top:1px solid #233c50;white-space:pre;line-height:1.45;color:#b7cfda}@media(max-width:820px){#fx-panel{left:8px;right:8px;bottom:54px;width:auto;max-height:42vh}}`;
    document.head.appendChild(style);
  }
  const panel = document.createElement('section');
  panel.id = 'fx-panel'; panel.setAttribute('aria-label', 'Game-like effects lab');
  panel.innerHTML = panelMarkup(pack, mode, enabled);
  map.getContainer().appendChild(panel);
  return panel;
}

export function mountFx(map, d) {
  const params = new URLSearchParams(location.search);
  // ponytail: internal field. MapLibre fades every paint change over 300 ms by default, so a change every 100 ms
  // repaints every frame and "10 Hz" saves nothing. Zero it unless ?fade=1 (kept to measure the difference).
  // Label/symbol placement fades too (Map option fadeDuration, 300 ms), same effect.
  if (params.get('fade') !== '1' && map.style?.stylesheet) { map.style.stylesheet.transition = { duration:0, delay:0 }; map._fadeDuration = 0; }
  let packId = Object.hasOwn(PACKS, params.get('fx')) ? +params.get('fx') : 0;
  const requested = params.has('on') ? params.get('on').split(',').filter(key => KEYS.includes(key)) : PACKS[packId].on;
  const enabled = new Set(requested);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mode = reduced ? 'off' : (MODES.has(params.get('anim')) ? params.get('anim') : PACKS[packId].anim);
  let threeState = 'no', threePromise = null, threeFx = null;
  let shadowMs = 0, last10Hz = -Infinity, decisionAt = -1, decision = false;
  const frames = [], repaints = [], threeFrames = [];
  let lastFrame = 0, lastHud = 0;
  const panel = mountPanel(map, packId, mode, enabled);
  const packSelect = panel.querySelector('#fx-pack'), animSelect = panel.querySelector('#fx-anim');
  if (reduced) { animSelect.value = 'off'; animSelect.disabled = true; animSelect.title = 'Forced off by prefers-reduced-motion'; }

  const syncChecks = () => panel.querySelectorAll('[data-fx-key]').forEach(input => { input.checked = enabled.has(input.dataset.fxKey); });
  const syncUrl = includeOn => {
    const url = new URL(location.href);
    url.searchParams.set('variant', 'B'); url.searchParams.set('fx', String(packId));
    if (includeOn) url.searchParams.set('on', KEYS.filter(key => enabled.has(key)).join(','));
    else url.searchParams.delete('on');
    url.searchParams.set('anim', mode);
    history.replaceState(null, '', url);
  };
  const recordThreeRender = ms => {
    const now = performance.now(), prev = threeFrames.at(-1);
    if (prev && now - prev.t < 8) prev.ms += ms;
    else threeFrames.push({ t:now, ms });
  };
  const updateThreeState = () => { panel.querySelector('#fx-three-state').textContent = `three.js: ${threeState}`; };
  const loadThree = async () => {
    if (threeFx) return threeFx;
    if (!threePromise) {
      threeState = 'loading'; updateThreeState();
      threePromise = import('./fx3d.js').then(mod => {
        threeFx = mod.createFx3D(map, d, { recordRenderMs:recordThreeRender, recordShadowMs:ms => { shadowMs = ms; } });
        threeState = 'yes'; updateThreeState();
        for (const key of THREE_KEYS) threeFx.set(key, enabled.has(key));
        return threeFx;
      }).catch(err => {
        threeState = 'failed'; updateThreeState(); console.error('three.js effects failed to load:', err);
        return null;
      });
    }
    return threePromise;
  };

  const apply = async (key, on) => {
    if (THREE_KEYS.has(key)) {
      if (on) (await loadThree())?.set(key, enabled.has(key));
      else threeFx?.set(key, false);
      return;
    }
    if (key === 'glow-pulse') { if (!on) resetGlowPulse(map); return; }
    if (key === 'water-ripple' && !on) {
      if (map.getLayer('fx-water-sheen-fill')) map.setPaintProperty('fx-water-sheen-fill', 'line-opacity', .3);
      if (map.getLayer('fx-water-sheen-edge')) map.setPaintProperty('fx-water-sheen-edge', 'line-opacity', .62);
    }
    if (on) addMapEffect(map, key); else removeLayers(map, MAP_LAYERS[key]);
  };
  const set = (key, on, updateUrl = true) => {
    if (!KEYS.includes(key)) throw new Error(`Unknown effect: ${key}`);
    on = Boolean(on); if (on) enabled.add(key); else enabled.delete(key);
    syncChecks(); const pending = apply(key, on);
    if (updateUrl) syncUrl(true);
    return pending;
  };
  const setAnim = value => {
    if (!MODES.has(value)) throw new Error(`Unknown animation mode: ${value}`);
    mode = reduced ? 'off' : value; animSelect.value = mode; last10Hz = -Infinity; decisionAt = -1;
    syncUrl(true); return mode;
  };
  const setPack = n => {
    n = +n; if (!Object.hasOwn(PACKS, n)) throw new Error(`Unknown FX pack: ${n}`);
    packId = n; packSelect.value = String(n);
    const next = new Set(PACKS[n].on), pending = [];
    for (const key of KEYS) if (enabled.has(key) !== next.has(key)) pending.push(set(key, next.has(key), false));
    mode = reduced ? 'off' : PACKS[n].anim; animSelect.value = mode; last10Hz = -Infinity; decisionAt = -1;
    syncChecks(); syncUrl(false); return Promise.all(pending);
  };

  const shouldTick = now => {
    if (document.hidden || mode === 'off') return false;
    if (now === decisionAt) return decision;
    decisionAt = now;
    if (mode === 'raf') decision = true;
    else if (mode === 'move') decision = map.isMoving() || Boolean(map.__fxOrbiting);
    else { decision = now - last10Hz >= 100; if (decision) last10Hz = now; }
    return decision;
  };

  const numbers = () => {
    const now = performance.now();
    while (frames[0]?.t < now - 2000) frames.shift();
    while (repaints[0] < now - 1000) repaints.shift();
    while (threeFrames[0]?.t < now - 2000) threeFrames.shift();
    const intervals = frames.map(x => x.dt).sort((a, b) => a - b);
    const mean = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    const repaintRate = repaints.length;
    const threeMs = threeFrames.length ? threeFrames.reduce((sum, x) => sum + x.ms, 0) / threeFrames.length : 0;
    return { fps:mean ? 1000 / mean : 0, p95FrameMs:intervals.length ? intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * .95))] : 0,
      repaintsPerSec:repaintRate, threeMsPerFrame:threeMs, shadowRebuildMs:shadowMs, threeLoaded:threeState,
      osirisMainThreadPct:Math.min(100, repaintRate * 6.6), anim:mode, pack:packId, enabled:KEYS.filter(key => enabled.has(key)) };
  };
  const paintHud = () => {
    const s = numbers(); panel.querySelector('#fx-metrics').textContent =
      `fps ${s.fps.toFixed(1)} · p95 ${s.p95FrameMs.toFixed(1)} ms\n` +
      `map repaints/s ${s.repaintsPerSec.toFixed(1)}\n` +
      `three render ${s.threeMsPerFrame.toFixed(2)} ms/frame\n` +
      `shadow rebuild ${s.shadowRebuildMs.toFixed(1)} ms\n` +
      `Osiris rough ${s.osirisMainThreadPct.toFixed(0)}% main thread`;
  };

  const onRender = () => repaints.push(performance.now());
  map.on('render', onRender);
  const loop = now => {
    if (!document.hidden) {
      if (lastFrame) frames.push({ t:now, dt:now - lastFrame }); lastFrame = now;
      if (shouldTick(now)) {
        const t = now / 1000;
        if (enabled.has('water-ripple')) {
          const step = Math.floor(t * 10) % RIPPLE_DASH.length, wave = .5 + .5 * Math.sin(t * 3.2);
          for (const id of ['fx-water-ripple-bed', 'fx-water-ripple-crest']) if (map.getLayer(id)) map.setPaintProperty(id, 'line-dasharray', RIPPLE_DASH[step]);
          if (map.getLayer('fx-water-ripple-bed')) map.setPaintProperty('fx-water-ripple-bed', 'line-opacity', .12 + .2 * wave);
          if (map.getLayer('fx-water-sheen-fill')) map.setPaintProperty('fx-water-sheen-fill', 'line-opacity', .22 + .13 * wave);
          if (map.getLayer('fx-water-sheen-edge')) map.setPaintProperty('fx-water-sheen-edge', 'line-opacity', .45 + .3 * (1 - wave));
        }
        if (enabled.has('glow-pulse')) {
          const pulse = .5 + .5 * Math.sin(t * 4.2);
          if (map.getLayer('roads-halo')) { map.setPaintProperty('roads-halo', 'line-opacity', .52 + .35 * pulse); map.setPaintProperty('roads-halo', 'line-width', ZI(10, 5 + pulse * 2, 14, 16 + pulse * 8, 17, 32 + pulse * 14)); }
          if (map.getLayer('roads-glow')) { map.setPaintProperty('roads-glow', 'line-opacity', .75 + .25 * (1 - pulse)); map.setPaintProperty('roads-glow', 'line-width', ZI(10, 2.5 + pulse, 14, 6 + pulse * 3, 17, 12 + pulse * 6)); }
        }
        if (threeFx?.tick(now)) map.triggerRepaint();
      }
      if (now - lastHud >= 500) { lastHud = now; paintHud(); }
    } else lastFrame = 0;
    requestAnimationFrame(loop);
  };

  packSelect.onchange = () => setPack(packSelect.value);
  animSelect.onchange = () => setAnim(animSelect.value);
  panel.querySelectorAll('[data-fx-key]').forEach(input => { input.onchange = () => set(input.dataset.fxKey, input.checked); });

  const api = { set, pack:setPack, anim:setAnim, stats:numbers, shouldTick,
    destroy() { map.off('render', onRender); threeFx?.destroy(); panel.remove(); } };
  window.__fx = api;
  for (const key of enabled) apply(key, true);
  if (reduced) syncUrl(params.has('on'));
  requestAnimationFrame(loop);
  return api;
}
