// OWNER: 3D city worker. Everything the 3D view draws: buildings, flooded roads, report columns, POIs, districts, camera, orbit, sky/fog.
// Contract with ui.js: LAYERS3D drives toggles + legend; camera3d(d) → map options; addLayers3D(map, d); startOrbit(map).
import { COLOR, loadPoints, loadDistricts, dangerGrid, depthText, loadTransitLines } from './data.js';
import { bindPopups } from './layers2d.js';

export const LAYERS3D = [
  { key:'buildings', label:'Buildings', ids:['bld3d'], legend:[
    { shape:'swatch', color:'#2b3650', label:'low-rise (no OSM height: assumed 6-24 m); shown from zoom 14' },
    { shape:'swatch', color:'#8297c8', label:'tall (lighter = taller, drawn at most 130 m)' }] },
  { key:'roads', label:'Flooded roads', ids:['roads','roads-water','roads-glow','roads-halo','roads-ribbon','roads-flow'], legend:[
    { shape:'line', color:'#2f7fe0', label:'blue water glow under every blocked or risky road' }, { shape:'line', color:'#ef4444', label:'blocked (neon line, moving dashes, raised ribbon)' }, { shape:'line', color:'#fb923c', label:'risky (neon line, raised ribbon)' }, { shape:'line', color:'#facc15', label:'caution (thin faint line)' }] },
  { key:'danger', label:'Danger hexes', ids:['danger3d','danger3d-line'], count: d => dangerGrid(d, null).features.filter(f => f.properties.level >= 2).length, legend:[
    { shape:'swatch', color:'#b3263a', label:'danger: blocked roads (outlined cell, slow pulse)' }, { shape:'swatch', color:'#f2a93b', label:'warning: risky roads, reports' }, { shape:'swatch', color:'#2f7fe0', label:'watch (faint outline only)' }] },
  { key:'reports', label:'Depth columns', ids:['reports','reports-cap','reports-ring','reports-glow','reports-label','reports-cl','reports-cl-n'], count: d => d.reports.features.length, legend:[
    { shape:'swatch', color:'#4fc3ff', label:'ankle (under 35 cm)' }, { shape:'swatch', color:'#f2a93b', label:'knee (35-70 cm)' },
    { shape:'swatch', color:'#e5304a', label:'waist (70-120 cm)' }, { shape:'swatch', color:'#ff3d81', label:'over head (120 cm+); taller = deeper. Pulsing ring = report spot' },
    { shape:'swatch', color:'#ffffff', label:'white cap: road closed. Circles with numbers: grouped reports (zoom in)' }] },
  { key:'districts', label:'District signals', ids:['dz3d'], legend:[
    { shape:'swatch', color:'#f43f5e', label:'khet block: redder and taller = more reports and blocked/risky roads (fades out by zoom 13.8 as buildings take over)' }] },
  { key:'transit', label:'Metro, rail, stations', ids:['transit3d','transit3d-osm','stations3d','stations3d-label','stn-flood-ring','stn-flood-label'], legend:[
    { shape:'line', color:'#38bdf8', label:'metro / sky train / light rail (OSM)' }, { shape:'line', color:'#c4b5fd', label:'heavy rail' }, { shape:'dot', color:'#ffffff', label:'rail station (label)' }, { shape:'dot', color:'#ef4444', label:'red ring + chip: report of 30 cm+ or blocked road within 300 m of a station (none drawn = no station is flooded in view)' }] },
  { key:'hospitals', label:'Hospitals', ids:['hospitals3d','hospitals3d-gb','hospitals3d-g'], legend:[{ shape:'dot', color:'#2dd4bf', label:'hospital: pillar with an H badge' }] },
  { key:'shelters', label:'Shelters', ids:['shelters3d','shelters3d-gb','shelters3d-g'], legend:[{ shape:'dot', color:'#a3e635', label:'possible gathering site: pillar with an S badge, not an official evacuation list' }] },
  { key:'pumping', label:'Pumps and sluices', ids:['pumping3d','pumping3d-gb','pumping3d-g'], legend:[{ shape:'dot', color:'#818cf8', label:'pumping station or sluice gate: pillar with a P badge' }] },
  { key:'parks', label:'Parks', ids:['parks3d'], legend:[{ shape:'swatch', color:'#17503f', label:'park or green space (OSM)' }] },
  { key:'radar', label:'Rain radar', ids:['radar'], legend:[
    { shape:'swatch', color:'#88ddee', label:'radar: light rain' }, { shape:'swatch', color:'#0077ee', label:'radar: moderate' },
    { shape:'swatch', color:'#ffaa00', label:'radar: heavy' }, { shape:'swatch', color:'#ff2200', label:'radar: very heavy (no colour = no rain now)' }] },
];

const DENSE = [100.5608, 13.7385]; // Asok, fallback when there is no flood data
const PANEL = () => (window.innerWidth > 820 ? 340 : 0);

// Densest smoothed 0.01° cell of blocked/risky road vertices and open reports, limited to 11 km around the core where OSM buildings are dense.
function hotspot(d) {
  const cells = new Map(), add = (x, y, w) => { const k = `${Math.floor(x / .01)},${Math.floor(y / .01)}`; cells.set(k, (cells.get(k) || 0) + w); };
  const near = (x, y) => Math.hypot((x - DENSE[0]) * 108, (y - DENSE[1]) * 111) < 30;
  for (const f of d.reports.features) { const [x, y] = f.geometry.coordinates; if (near(x, y)) add(x, y, f.properties.closed ? 3 : 1.5); }
  for (const f of d.roads.features) {
    if (f.properties.sev < 3) continue;
    const w = f.properties.sev === 4 ? 1 : .6; let c = f.geometry.coordinates; if (Array.isArray(c[0][0])) c = c.flat();
    for (const [x, y] of c) if (near(x, y)) add(x, y, w);
  }
  let best = null, bs = 0;
  for (const k of cells.keys()) {
    const [i, j] = k.split(',').map(Number); let s = 0, sx = 0, sy = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const v = cells.get(`${i + a},${j + b}`) || 0; s += v; sx += v * (i + a + .5); sy += v * (j + b + .5); }
    const cx = sx / s * .01, cy = sy / s * .01, km = Math.hypot((cx - DENSE[0]) * 108, (cy - DENSE[1]) * 111);
    s *= 1 + 1.2 * Math.exp(-((km / 12) ** 2));
    if (s > bs) { bs = s; best = [cx, cy]; }
  }
  // OSM buildings thin out east of Ratchada, where the flood is: sit between the core and the flood cluster so both are in frame
  return best ? [DENSE[0] + .85 * (best[0] - DENSE[0]), DENSE[1] + .85 * (best[1] - DENSE[1])] : DENSE;
}
let ORBIT_CENTER = DENSE;
export const camera3d = d => ({ center: (ORBIT_CENTER = hotspot(d)), zoom: 14.1, pitch: 60, bearing: -28 });

const m2 = (y, m) => [m / 111320 / Math.cos(y * Math.PI / 180), m / 111320];
const rect = (x, y, mx, my) => { const [dx, dy] = m2(y, mx); void my; return [[x-dx,y-dy],[x+dx,y-dy],[x+dx,y+dy],[x-dx,y+dy],[x-dx,y-dy]]; };
const FC = features => ({ type:'FeatureCollection', features });

// Depth columns (data skyline). Min height 30 m, +2.5 m per cm of depth (capped at 150 cm), 14 m light cap.
function columns(reports) {
  return FC(reports.features.map(f => {
    const [x, y] = f.geometry.coordinates, depth = Math.min(f.properties.depth || 0, 150), base = 45 + depth * 3.5;
    return { type:'Feature', properties:{ ...f.properties, depth, base, top: base + 10 }, geometry:{ type:'Polygon', coordinates:[rect(x, y, 16)] } };
  }));
}
// every report with a depth or a closure gets a label candidate; the symbol layer culls collisions, deepest first
const labelPts = reports => FC(reports.features.filter(f => f.properties.depth > 0 || f.properties.closed)
  .map(f => ({ type:'Feature', properties:{ label: f.properties.depth > 0 ? depthText(f.properties.depth) : 'CLOSED', rank: -(f.properties.depth || 0) - (f.properties.closed ? 500 : 0), closed: f.properties.closed }, geometry:f.geometry })));

// Raised ribbons for blocked/risky roads: one quad per segment, hovering above low-rise roofs so buildings do not hide them.
function ribbons(roads) {
  const out = [];
  for (const f of roads.features) {
    const p = f.properties; if (p.sev < 2) continue;
    const half = p.sev === 4 ? 6 : p.sev === 3 ? 4 : 3, lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i-1], [x1, y1] = line[i], [kx, ky] = m2(y0, 1);
      const ex = (x1 - x0) / kx, ey = (y1 - y0) / ky, len = Math.hypot(ex, ey); if (len < .5) continue;
      const nx = -ey / len * half * kx, ny = ex / len * half * ky;
      out.push({ type:'Feature', properties:{ sedan:p.sedan, lift: p.sev === 4 ? 40 : p.sev === 3 ? 30 : 20 }, geometry:{ type:'Polygon', coordinates:[[[x0+nx,y0+ny],[x1+nx,y1+ny],[x1-nx,y1-ny],[x0-nx,y0-ny],[x0+nx,y0+ny]]] } });
    }
  }
  return FC(out);
}

const pillars = pts => FC((pts?.features || []).filter(f => f.geometry?.type === 'Point').map(f => {
  const [x, y] = f.geometry.coordinates; return { type:'Feature', properties:f.properties || {}, geometry:{ type:'Polygon', coordinates:[rect(x, y, 11)] } };
}));
const points = pts => FC((pts?.features || []).filter(f => f.geometry?.type === 'Point'));

const H = ['case', ['>', ['to-number', ['get','render_height'], 0], 3], ['get','render_height'], ['+', 8, ['*', 3, ['%', ['to-number', ['id'], 0], 7]]]]; // 6-24 m when untagged
const HC = ['min', H, 130];
const empty = FC([]);
const ZI = (...s) => ['interpolate',['linear'],['zoom'], ...s];
// heights that stay readable when zoomed out: ×5 at zoom 12, ×1 from zoom 14
const ZH = e => ZI(12, ['*', e, 5], 14, e);

const BAND = ['case', ['get','closed'], '#ff1744', ['step', ['get','depth'], '#4fc3ff', 35, '#f2a93b', 70, '#e5304a', 120, '#ff3d81']];
const BAND_CAP = ['case', ['get','closed'], '#ffffff', ['step', ['get','depth'], '#d8f3ff', 35, '#ffe6b8', 70, '#ffc2ca', 120, '#ffc4dc']];

export function addLayers3D(map, d) {
  // night-city look: low cool key light so tower sides fall into shadow, near-black fog that swallows the horizon
  map.setLight({ anchor:'viewport', color:'#b4c6e6', intensity:0.6, position:[1.2, 210, 40] });
  map.setSky({ 'sky-color':'#0b1020', 'horizon-color':'#1b2a4a', 'fog-color':'#07090d',
    'sky-horizon-blend':0.12, 'horizon-fog-blend':0.6, 'fog-ground-blend':0.6 });
  hud(map.getContainer());
  try { map.setPadding?.({ left:PANEL(), right:0, top:0, bottom:0 }); } catch { /* optional */ }

  // neutral ground so building height and distance read; tilted road names are noise, keep motorway/trunk/primary only
  if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', '#07090d');
  for (const id of ['landuse_residential', 'landcover_wood', 'landuse_park']) if (map.getLayer(id)) map.setPaintProperty(id, 'fill-color', '#0b0e13');
  if (map.getLayer('water')) map.setPaintProperty('water', 'fill-color', '#0a1a33');
  if (map.getLayer('waterway')) map.setPaintProperty('waterway', 'line-color', '#12345e');
  for (const l of map.getStyle().layers) {
    if (l.type === 'symbol' && l['source-layer'] === 'transportation_name' && !/motorway|trunk|primary/.test(l.id)) map.setLayoutProperty(l.id, 'visibility', 'none');
  }

  // base streets: thin dark slate, lighter casing only on major roads so the flood colours pop
  const lw = (a, b, c) => ZI(11, a, 14, b, 17, c);
  const roadStyle = { highway_minor:['#161b24', lw(.2, .6, 4)], highway_path:['#12161d', lw(.1, .3, 1.5)],
    highway_major_casing:['#232933', lw(.9, 2.6, 11)], highway_major_inner:['#1a1f28', lw(.4, 1.3, 8)],
    highway_motorway_casing:['#2a303a', lw(1.3, 3.6, 13)], highway_motorway_inner:['#1d232d', lw(.7, 2.2, 10)] };
  for (const [id, [c, wd]] of Object.entries(roadStyle)) if (map.getLayer(id)) { map.setPaintProperty(id, 'line-color', c); map.setPaintProperty(id, 'line-width', wd); map.setPaintProperty(id, 'line-opacity', 1); }
  for (const id of ['highway_major_subtle', 'highway_motorway_subtle']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');

  const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol' && map.getLayoutProperty(l.id, 'visibility') !== 'none')?.id;
  const cur = d.frames.findLast(f => !f.nowcast);
  if (cur) {
    map.addSource('radar', { type:'raster', tiles:[cur.url], tileSize:256, maxzoom:7 });
    map.addLayer({ id:'radar', type:'raster', source:'radar', paint:{ 'raster-opacity':0.45, 'raster-fade-duration':0 } }, firstSymbol);
  }
  map.addLayer({ id:'parks3d', type:'fill', source:'openmaptiles', 'source-layer':'park', minzoom:11,
    paint:{ 'fill-color':'#0f2a22', 'fill-opacity':0.9 } }, firstSymbol);
  if (map.getLayer('building')) map.setLayoutProperty('building', 'visibility', 'none');

  map.addSource('dz3d', { type:'geojson', data:empty });
  map.addLayer({ id:'dz3d', type:'fill-extrusion', source:'dz3d', maxzoom:13.8,
    paint:{ 'fill-extrusion-height':['*', ['min',['get','signals'],30], 12], 'fill-extrusion-base':0,
      'fill-extrusion-color':['interpolate',['linear'],['get','signals'], 0,'#1b2a44', 5,'#4c2a6b', 15,'#a02050', 40,'#e8456a'],
      'fill-extrusion-opacity':ZI(10, .4, 12.6, .3, 13.8, 0) } }, firstSymbol);

  // danger hexes (same derived cells as 2D): translucent water-like prisms, taller = more dangerous
  map.addSource('danger3d', { type:'geojson', data:dangerGrid(d, null) });
  const lvl = ['get','level'];
  map.addLayer({ id:'danger3d', type:'fill', source:'danger3d', filter:['>=',lvl,2],
    paint:{ 'fill-color':['match',lvl, 3,'#b3263a', '#7a4a12'], 'fill-opacity':ZI(11, .2, 14, .12, 16, .06) } }, firstSymbol);
  map.addLayer({ id:'danger3d-line', type:'line', source:'danger3d',
    paint:{ 'line-color':['match',lvl, 3,'#ff5a6e', 2,'#f2a93b', '#2f7fe0'], 'line-width':['match',lvl, 3,1.4, 2,1, .6], 'line-blur':.6,
      'line-opacity':['match',lvl, 3,.7, 2,.45, .12] } }, firstSymbol);

  // OpenFreeMap has building data only in z14 tiles (a tileSize-256 second source is rejected by MapLibre), so the default camera sits at zoom 14.3.
  map.addLayer({ id:'bld3d', type:'fill-extrusion', source:'openmaptiles', 'source-layer':'building', minzoom:13.9,
    paint:{ 'fill-extrusion-height':HC, 'fill-extrusion-base':['min',['coalesce',['get','render_min_height'],0],HC],
      'fill-extrusion-color':['interpolate',['linear'],HC, 6,'#1f2838', 25,'#2b3650', 60,'#425277', 130,'#8297c8'],
      'fill-extrusion-opacity':0.92, 'fill-extrusion-vertical-gradient':true } });

  // flooded roads: wide ground glow (halo, glow, core) + raised ribbons for blocked/risky/caution
  map.addSource('roads', { type:'geojson', data:d.roads });
  // neon roads: blue water glow, narrow coloured bloom, white-hot core; caution stays a thin faint line so yellow does not flood the view
  const hot = ['>=',['get','sev'],3], w = (a, b, c) => ZI(10, a, 14, b, 17, c), cap = { 'line-cap':'round', 'line-join':'round' };
  map.addLayer({ id:'roads-water', type:'line', source:'roads', filter:hot, layout:cap,
    paint:{ 'line-color':'#2f7fe0', 'line-width':w(8, 30, 60), 'line-blur':w(5, 16, 30), 'line-opacity':0.4 } });
  map.addLayer({ id:'roads-halo', type:'line', source:'roads', filter:hot, layout:cap,
    paint:{ 'line-color':COLOR, 'line-width':w(5, 16, 32), 'line-blur':w(4, 9, 18), 'line-opacity':0.75 } });
  map.addLayer({ id:'roads-glow', type:'line', source:'roads', filter:hot, layout:cap,
    paint:{ 'line-color':COLOR, 'line-width':w(2.5, 6, 12), 'line-blur':1.2, 'line-opacity':0.95 } });
  map.addLayer({ id:'roads', type:'line', source:'roads', layout:cap,
    paint:{ 'line-color':['case', hot, ['match',['get','sedan'],'blocked','#ffe1e1','#fff0dc'], COLOR], 'line-width':ZI(10, ['case', hot, .8, .6], 14, ['case', hot, 1.6, 1.4], 17, 3),
      'line-opacity':['match',['get','sev'], 1,.15, 2,.45, 1] } });
  map.addLayer({ id:'roads-flow', type:'line', source:'roads', filter:['==',['get','sev'],4], layout:{ 'line-join':'round' },
    paint:{ 'line-color':'#ffffff', 'line-width':w(1, 2.4, 4.5), 'line-opacity':0.9, 'line-dasharray':[0, 4, 3] } });
  map.addSource('ribbons', { type:'geojson', data:ribbons(d.roads) });
  map.addLayer({ id:'roads-ribbon', type:'fill-extrusion', source:'ribbons',
    paint:{ 'fill-extrusion-height':ZH(['+',['get','lift'],6]), 'fill-extrusion-base':ZH(['get','lift']), 'fill-extrusion-opacity':0.95, 'fill-extrusion-vertical-gradient':false,
      'fill-extrusion-color':['match',['get','sedan'],'blocked','#ff3b3b','risky','#ff9a3c','#ffe14a'] } });

  // report columns by depth band; clustered circles at low zoom
  map.addSource('reports', { type:'geojson', data:columns(d.reports) });
  map.addSource('report-pts', { type:'geojson', data:{ type:'FeatureCollection', features:d.reports.features },
    cluster:true, clusterRadius:50, clusterMaxZoom:12, clusterProperties:{ maxd:['max',['get','depth']], anyClosed:['max',['case',['get','closed'],1,0]] } });
  map.addSource('report-labels', { type:'geojson', data:labelPts(d.reports) });
  const ringCol = ['case',['get','closed'],'#ffffff',['step',['get','depth'],'#4fc3ff',35,'#f2a93b',70,'#e5304a',120,'#ff3d81']];
  map.addLayer({ id:'reports-cl', type:'circle', source:'report-pts', filter:['has','point_count'], maxzoom:13,
    paint:{ 'circle-radius':['step',['get','point_count'], 14, 10, 19, 40, 25], 'circle-opacity':.85, 'circle-stroke-width':2.5, 'circle-stroke-color':'#ffffff',
      'circle-color':['case',['>',['get','anyClosed'],0],'#ff1744',['step',['get','maxd'],'#4fc3ff',35,'#f2a93b',70,'#e5304a',120,'#ff3d81']] } });
  map.addLayer({ id:'reports-cl-n', type:'symbol', source:'report-pts', filter:['has','point_count'], maxzoom:13,
    layout:{ 'text-field':['get','point_count_abbreviated'], 'text-font':['Noto Sans Bold'], 'text-size':12, 'text-allow-overlap':true },
    paint:{ 'text-color':'#111827' } });
  map.addLayer({ id:'reports-ring', type:'circle', source:'report-pts', filter:['!',['has','point_count']], minzoom:12.5,
    paint:{ 'circle-pitch-alignment':'map', 'circle-radius':ZI(12, 6, 14, 18, 17, 70), 'circle-color':'rgba(0,0,0,0)',
      'circle-stroke-width':ZI(12, 1.5, 16, 3), 'circle-stroke-color':ringCol, 'circle-blur':.3, 'circle-stroke-opacity':.95 } });
  map.addLayer({ id:'reports-glow', type:'circle', source:'report-pts', filter:['!',['has','point_count']], minzoom:12.5,
    paint:{ 'circle-pitch-alignment':'map', 'circle-radius':ZI(12, 4, 14, 10, 17, 36), 'circle-color':ringCol, 'circle-blur':1, 'circle-opacity':.55 } });
  map.addLayer({ id:'reports', type:'fill-extrusion', source:'reports', minzoom:12.5,
    paint:{ 'fill-extrusion-height':ZH(['get','base']), 'fill-extrusion-base':0, 'fill-extrusion-color':BAND, 'fill-extrusion-opacity':0.95 } });
  map.addLayer({ id:'reports-cap', type:'fill-extrusion', source:'reports', minzoom:12.5,
    paint:{ 'fill-extrusion-height':ZH(['get','top']), 'fill-extrusion-base':ZH(['get','base']), 'fill-extrusion-color':BAND_CAP,
      'fill-extrusion-opacity':1, 'fill-extrusion-vertical-gradient':false } });
  map.addLayer({ id:'reports-label', type:'symbol', source:'report-labels', minzoom:12.5,
    layout:{ 'text-field':['get','label'], 'text-font':['Noto Sans Bold'], 'text-size':ZI(12, 10, 16, 13), 'text-transform':'uppercase', 'text-letter-spacing':.08, 'text-variable-anchor':['bottom','top','left','right'], 'text-radial-offset':2.2, 'text-max-width':14,
      'symbol-sort-key':['get','rank'], 'text-padding':6, 'text-allow-overlap':false, 'text-pitch-alignment':'viewport' },
    paint:{ 'text-color':'#ffffff', 'text-halo-color':['case',['get','closed'],'#b30026','rgba(7,9,13,.9)'], 'text-halo-width':1.8 } });

  // transit as spatial anchors: OSM rail/metro lines from the vector tiles (+ optional route snapshot), station dots with names
  const rail = ['in',['get','class'],['literal',['rail','transit']]];
  map.addSource('transit3d', { type:'geojson', data:empty });
  const tcol = ['case',['!=',['coalesce',['get','color'],''],''],['get','color'],['match',['get','kind'],'metro','#38bdf8','monorail','#e879f9','#4ade80']];
  map.addLayer({ id:'transit3d-osm', type:'line', source:'openmaptiles', 'source-layer':'transportation', filter:rail, minzoom:10, layout:{ 'line-cap':'round' },
    paint:{ 'line-color':['match',['get','subclass'],'rail','#6d5fa8','#3b7be0'], 'line-width':ZI(10, 1, 14, 2, 17, 5), 'line-opacity':.8 } });
  map.addLayer({ id:'transit3d', type:'line', source:'transit3d', minzoom:10, layout:{ 'line-cap':'round' },
    paint:{ 'line-color':tcol, 'line-width':ZI(10, 1.5, 14, 2.5, 17, 6), 'line-blur':.4, 'line-opacity':.9 } });
  map.addLayer({ id:'stations3d', type:'circle', source:'openmaptiles', 'source-layer':'poi', filter:['all',['==',['get','class'],'railway'],['==',['get','subclass'],'station']], minzoom:11.5,
    paint:{ 'circle-radius':ZI(12, 3, 16, 7), 'circle-color':'#ffffff', 'circle-stroke-color':'#38bdf8', 'circle-stroke-width':2, 'circle-pitch-alignment':'map' } });
  map.addLayer({ id:'stations3d-label', type:'symbol', source:'openmaptiles', 'source-layer':'poi', filter:['all',['==',['get','class'],'railway'],['==',['get','subclass'],'station']], minzoom:12.5,
    layout:{ 'text-field':['coalesce',['get','name:latin'],['get','name']], 'text-font':['Noto Sans Bold'], 'text-size':ZI(12, 9, 16, 12), 'text-offset':[0, -1.1], 'text-anchor':'bottom', 'text-optional':true, 'text-transform':'uppercase', 'text-letter-spacing':.1 },
    paint:{ 'text-color':'#cfe6ff', 'text-halo-color':'rgba(7,9,13,.9)', 'text-halo-width':1.5 } });
  loadTransitLines().then(fc => { if (fc && map.getSource('transit3d')) map.getSource('transit3d').setData(fc); }).catch(() => {});

  // OSM POIs: short pillars + a ground glyph; data arrives async via the shared Overpass queue
  const poi = (key, color, glyph) => {
    map.addSource(`${key}3d`, { type:'geojson', data:empty });
    map.addSource(`${key}3d-pt`, { type:'geojson', data:empty });
    map.addLayer({ id:`${key}3d`, type:'fill-extrusion', source:`${key}3d`, minzoom:12,
      paint:{ 'fill-extrusion-height':ZI(12, 120, 16, 55), 'fill-extrusion-base':0, 'fill-extrusion-color':color, 'fill-extrusion-opacity':0.95 } });
    map.addLayer({ id:`${key}3d-gb`, type:'circle', source:`${key}3d-pt`, minzoom:13,
      paint:{ 'circle-radius':ZI(13, 7, 17, 11), 'circle-color':'#0a1424', 'circle-stroke-color':color, 'circle-stroke-width':2.5, 'circle-translate':[0, -34], 'circle-translate-anchor':'viewport', 'circle-pitch-alignment':'viewport' } });
    map.addLayer({ id:`${key}3d-g`, type:'symbol', source:`${key}3d-pt`, minzoom:13,
      layout:{ 'text-field':glyph, 'text-font':['Noto Sans Bold'], 'text-size':ZI(13, 11, 17, 17), 'text-allow-overlap':true, 'text-ignore-placement':true,
        'text-offset':[0, -2.3], 'text-pitch-alignment':'viewport' },
      paint:{ 'text-color':'#ffffff', 'text-halo-color':color, 'text-halo-width':0.6 } });
    loadPoints(key).then(g => { if (!g || !map.getSource(`${key}3d`)) return; map.getSource(`${key}3d`).setData(pillars(g)); map.getSource(`${key}3d-pt`).setData(points(g)); });
  };
  poi('hospitals', '#2dd4bf', 'H'); poi('shelters', '#a3e635', 'S'); poi('pumping', '#818cf8', 'P');

  stationChips(map, d);
  loadDistricts(d).then(z => { if (z && map.getSource('dz3d')) map.getSource('dz3d').setData(z.polys); });
  bindPopups(map);
  animate(map);
}

// Vignette + faint dot grid over the canvas; pointer-events off so the map still gets every input.
function hud(el) {
  const v = document.createElement('div');
  v.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;background:radial-gradient(ellipse at 55% 45%,transparent 55%,rgba(0,0,0,.55) 100%),radial-gradient(rgba(255,255,255,.035) 1px,transparent 1px) 0 0/4px 4px';
  el.appendChild(v);
}

// One rAF loop: buildings rise on first load (1.2 s), report glows pulse, blocked roads get flowing dashes, danger hexes breathe.
// ponytail: setPaintProperty per frame; move to a custom WebGL layer if this ever costs frames on phones.
const DASH = [[0,4,3],[.5,4,2.5],[1,4,2],[1.5,4,1.5],[2,4,1],[2.5,4,.5],[3,4,0],[0,.5,3,3.5],[0,1,3,3],[0,1.5,3,2.5],[0,2,3,2],[0,2.5,3,1.5],[0,3,3,1],[0,3.5,3,.5]];
function animate(map) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now(); let step = -1, risen = false;
  const rise = k => { const h = ['*', HC, k]; map.setPaintProperty('bld3d', 'fill-extrusion-height', h); map.setPaintProperty('bld3d', 'fill-extrusion-base', ['min',['coalesce',['get','render_min_height'],0], h]); };
  const frame = now => {
    if (!map.getLayer('bld3d')) return;
    const t = (now - t0) / 1000;
    if (!risen) { const k = Math.min(1, t / 1.2); rise(1 - (1 - k) ** 3); risen = k >= 1; }
    const p = (t % 1.6) / 1.6;
    map.setPaintProperty('reports-glow', 'circle-radius', ZI(12, 4 + 6 * p, 14, 10 + 22 * p, 17, 36 + 60 * p));
    map.setPaintProperty('reports-glow', 'circle-opacity', .55 * (1 - p));
    const s = Math.floor(t * 12) % DASH.length;
    if (s !== step) { step = s; map.setPaintProperty('roads-flow', 'line-dasharray', DASH[s]); }
    map.setPaintProperty('danger3d', 'fill-opacity', ZI(11, .2 + .06 * Math.sin(t * 2.1), 14, .12 + .05 * Math.sin(t * 2.1), 16, .06));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Orbit about a fixed centre at 1.5 deg/s (per-frame setBearing: smooth, no easeTo stutter). Pauses on pointer, wheel, touch or key input, resumes after 10 s idle.
// A small play/pause button sits bottom right; pausing from it is sticky until pressed again.
// Stations with deep water or a blocked road within 300 m: recomputed when the map goes idle (never per frame), from the rendered OSM station points.
function stationChips(map, d) {
  map.addSource('stn-flood', { type:'geojson', data:empty });
  map.addLayer({ id:'stn-flood-ring', type:'circle', source:'stn-flood', paint:{ 'circle-radius':ZI(12, 9, 16, 20), 'circle-color':'rgba(239,68,68,.25)', 'circle-stroke-color':'#ef4444', 'circle-stroke-width':3, 'circle-pitch-alignment':'map' } });
  map.addLayer({ id:'stn-flood-label', type:'symbol', source:'stn-flood', layout:{ 'text-field':['get','chip'], 'text-font':['Noto Sans Bold'], 'text-size':12, 'text-anchor':'top', 'text-offset':[0, 1.3], 'text-allow-overlap':true, 'text-pitch-alignment':'viewport' },
    paint:{ 'text-color':'#fff', 'text-halo-color':'#b30026', 'text-halo-width':2.2 } });
  const pts = [];
  for (const f of d.reports.features) if (f.properties.closed || f.properties.depth >= 30) pts.push([...f.geometry.coordinates, f.properties.depth || 0]);
  for (const f of d.roads.features) { if (f.properties.sev < 4) continue; let c = f.geometry.coordinates; if (Array.isArray(c[0][0])) c = c.flat(); for (const [x, y] of c) pts.push([x, y, 0]); }
  let last = '';
  map.on('idle', () => {
    if (map.getZoom() < 11.5) return;
    const seen = new Map();
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer:'poi', filter:['all',['==',['get','class'],'railway'],['==',['get','subclass'],'station']] })) {
      const [x, y] = f.geometry.coordinates || []; if (x == null) continue;
      let n = 0, deep = 0; for (const [px, py, dp] of pts) if (Math.hypot((px - x) * 108000, (py - y) * 111000) < 300) { n++; deep = Math.max(deep, dp); }
      if (n) seen.set(f.properties['name:latin'] || f.properties.name || `${x},${y}`, { type:'Feature', properties:{ chip: deep ? `water nearby ${deep} cm` : 'blocked road nearby' }, geometry:{ type:'Point', coordinates:[x, y] } });
    }
    const feats = [...seen.values()], sig = feats.map(f => f.geometry.coordinates.join()).sort().join('|');
    if (sig !== last) { last = sig; map.getSource('stn-flood')?.setData(FC(feats)); }
  });
}

export function startOrbit(map) {
  let on = true, held = false, timer = null;
  let last = 0;
  const tick = now => { if (on && !held && last && !map.isMoving()) map.setBearing(map.getBearing() + 1.5 * Math.min(now - last, 100) / 1000); last = now; requestAnimationFrame(tick); };
  const spin = () => { last = 0; };
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'orbit-toggle'; btn.textContent = 'Orbit: on'; btn.setAttribute('aria-pressed', 'true');
  btn.style.cssText = 'position:absolute;right:12px;bottom:42px;z-index:5;padding:6px 12px;border-radius:999px;border:1px solid #3b4a68;background:#0f1a2c;color:#e5edf9;font:600 12px system-ui,sans-serif;cursor:pointer';
  const cont = map.getContainer(); cont.appendChild(btn);
  const halt = () => { if (held) return; on = false; map.stop(); clearTimeout(timer); timer = setTimeout(() => { if (!held) { on = true; spin(); } }, 10000); };
  btn.addEventListener('click', e => {
    e.stopPropagation(); held = !held; clearTimeout(timer);
    if (held) { on = false; map.stop(); } else { on = true; spin(); }
    btn.textContent = held ? 'Orbit: paused' : 'Orbit: on'; btn.setAttribute('aria-pressed', String(!held));
  });
  ['pointerdown','touchstart','wheel','keydown'].forEach(ev => map.getCanvas().addEventListener(ev, halt, { passive:true }));
  requestAnimationFrame(tick);
}
