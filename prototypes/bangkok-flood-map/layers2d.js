// OWNER: 2D layers & data worker. Map layers, popups, radar timeline scrubber and rain chart for the 2D view.
// Contract with ui.js: LAYERS2D drives the layer toggles + legend; addLayers2D(map, d); mountTimeline(el, map, d).
// Registry entry: { key, label, ids:[map layer ids], count?: d => number, legend:[{shape,color,label}] }.
import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.7.0/dist/maplibre-gl.mjs';
import { COLOR, esc, ago, hhmm, loadPoints, loadDistricts, loadForecastGrid, loadTransitLines, loadDistrictRain, loadDischarge, snapToTransit, distM, warnOnce, dangerGrid, depthPoints, depthText } from './data.js';

// One colour per meaning: roads = traffic lights, rain = blues, every OSM class its own hue + letter.
const C = { blocked:'#ef4444', risky:'#fb923c', caution:'#facc15', ok:'#4ade80', rain:'#38bdf8', later:'#94a3b8',
  hospital:'#ec4899', shelter:'#14b8a6', pump:'#c2855a', fire:'#d6d3d1', landmark:'#c4b5fd', rail:'#e5e7eb', metro:'#60a5fa', sky:'#4ade80', airport:'#fde68a', canal:'#22d3ee', ferry:'#f59e0b', wl1:'#a3e635', wl2:'#fbbf24', wl3:'#f43f5e', wl0:'#94a3b8', traffy:'#e879f9', park:'#3b82f6' };
const DG = ['', 'rgba(56,189,248,.12)', 'rgba(251,146,60,.17)', 'rgba(239,68,68,.27)'];

// Order here = order of toggles and legend in the side panel.
export const LAYERS2D = [
  { key:'roads', label:'Flooded roads (for a sedan)', ids:['roads-ok','roads-glow','roads','roads-hit'], legend:[
    { shape:'line', color:C.blocked, label:'blocked for a sedan' }, { shape:'line', color:C.risky, label:'risky' },
    { shape:'line', color:C.caution, label:'caution' }, { shape:'line', color:C.ok, label:'passable (dim)' }] },
  { key:'reports', label:'Live reports', ids:['reports','reports-cluster','reports-cluster-count'], count: d => d.reports.features.length, legend:[
    { shape:'dot', color:'#0e3a5c', label:'cluster of reports (count, click to zoom)' }, { shape:'dot', color:C.rain, label:'verified report (official source, filled)' },
    { shape:'dot', color:'#7dd3fc', label:'unverified crowd report (hollow ring)' }, { shape:'dot', color:C.traffy, label:'Traffy report (purple ring)' },
    { shape:'dot', color:C.blocked, label:'report: road closed' }] },
  { key:'depth', label:'Depth labels', ids:['depth-dots','depth-labels'], count: d => depthPoints(d).features.length, legend:[
    { shape:'swatch', color:'#e6edf3', label:'ankle / knee / waist / over head + cm' }] },
  { key:'waterlevel', label:'Canal and river level (% of bank)', ids:['waterlevel','waterlevel-label'], count: d => d.water?.features.length || 0, legend:[
    { shape:'dot', color:C.wl1, label:'level below 70% of bank' }, { shape:'dot', color:C.wl2, label:'70-90% of bank' }, { shape:'dot', color:C.wl3, label:'over 90% of bank' }] },
  { key:'danger', label:'Danger grid (derived cells)', ids:['danger-grid','danger-grid-line'], count: d => dangerGrid(d, null).features.filter(f => f.properties.level >= 2).length, legend:[
    { shape:'swatch', color:DG[3], label:'danger: blocked roads' }, { shape:'swatch', color:DG[2], label:'warning: risky roads, reports' }, { shape:'swatch', color:DG[1], label:'watch: rain expected' }] },
  { key:'radar', label:'Rain radar', ids:['radar'], legend:[
    { shape:'swatch', color:'#88ddee', label:'radar: light rain' }, { shape:'swatch', color:'#0077ee', label:'radar: moderate' },
    { shape:'swatch', color:'#ffaa00', label:'radar: heavy' }] },
  { key:'raingrid', label:'Rain forecast (districts + 3x3 grid)', ids:['raingrid','raingrid-label','raindist-label'], legend:[
    { shape:'dot', color:C.rain, label:'rain soon (next 6 h)' }, { shape:'dot', color:C.later, label:'might rain later (24 h)' },
    { shape:'swatch', color:'#1e293b', label:'chip: District · rain n mm in 6 h' }] },
  { key:'districts', label:'District flood signals', ids:['districts-fill','districts-line','districts-label'], legend:[
    { shape:'swatch', color:'rgba(250,204,21,.45)', label:'district: 1-11 signals' }, { shape:'swatch', color:'rgba(251,146,60,.6)', label:'12-39 signals' },
    { shape:'swatch', color:'rgba(239,68,68,.75)', label:'40+ signals' }] },
  { key:'waterways', label:'Canals, rivers and ferry routes', ids:['canals','canals-label','ferry'], legend:[
    { shape:'line', color:C.canal, label:'canal / river (named)' }, { shape:'line', color:C.ferry, label:'ferry route' }] },
  { key:'rail', label:'Rail, metro and stations', ids:['rail','transit','stations','stations-label','station-water'], legend:[
    { shape:'line', color:C.rail, label:'rail line (dashed)' }, { shape:'line', color:C.metro, label:'metro / sky train line (OSM colour)' },
    { shape:'dot', color:C.metro, label:'metro / sky train station (line colour)' }, { shape:'dot', color:'#e5e7eb', label:'rail station / halt' },
    { shape:'swatch', color:'#0c2a44', label:'station with water nearby (chip: name, cm)' }] },
  { key:'airports', label:'Airports', ids:['airports','airports-label'], legend:[{ shape:'dot', color:C.airport, label:'airport' }] },
  { key:'landmarks', label:'Landmarks (OSM)', ids:['landmarks','landmarks-label'], legend:[{ shape:'dot', color:C.landmark, label:'named landmark' }] },
  { key:'hospitals', label:'Hospitals (OSM)', ids:['hospitals','hospitals-g'], legend:[{ shape:'dot', color:C.hospital, label:'H  hospital' }] },
  { key:'shelters', label:'Possible shelters (OSM, unofficial)', ids:['shelters','shelters-g'], legend:[{ shape:'dot', color:C.shelter, label:'S  possible gathering site' }] },
  { key:'pumping', label:'Pumps and sluice gates (OSM)', ids:['pumping','pumping-g'], legend:[{ shape:'dot', color:C.pump, label:'P  pump / sluice / lock / weir' }] },
  { key:'piers', label:'Ferry piers and boat stops (OSM)', ids:['piers','piers-g'], legend:[{ shape:'dot', color:C.ferry, label:'ferry pier / boat stop' }] },
  { key:'parking', label:'Car parks, multi-storey (OSM)', ids:['parking','parking-g'], legend:[{ shape:'dot', color:C.park, label:'P  car park / multi-storey' }] },
  { key:'fire', label:'Fire and rescue stations (OSM)', ids:['fire','fire-g'], legend:[{ shape:'dot', color:C.fire, label:'F  fire station' }] },
];

// ---------- popups (one click handler picks the most useful thing under the cursor) ----------
const VERDICT = v => v ? `<span class="pill ${v}">${v}</span>` : '<span class="dim">n/a</span>';
const kv = (k, v) => v ? `<div class="pp-row"><span>${k}</span><b>${v}</b></div>` : '';
const title = (t, sub) => `<div class="pp-t">${esc(t)}</div>${sub ? `<div class="pp-s">${esc(sub)}</div>` : ''}`;
const nm = p => p['name:en'] || p.name || p.name_en || p['name:latin'] || '';
const DEPTHC = cm => cm < 35 ? '#7dd3fc' : cm < 70 ? '#facc15' : cm < 120 ? '#fb923c' : '#ef4444';
const WATER = { pumping_station:'Pumping station', water_works:'Water works', sluice_gate:'Sluice gate', lock_gate:'Lock gate', weir:'Weir' };
const STATION = { station:'Railway station', halt:'Railway halt', subway:'Metro station', light_rail:'Sky train station', monorail:'Monorail station', tram:'Tram stop' };
const POPUPS = {
  reports: p => title('Flood report', `${p.source}${p.tier ? ' · ' + p.tier : ''}`) + kv('Status', ({ verified:'verified (official source)', unverified:'unverified crowd report', traffy:'Traffy (citizen app), unverified' })[p.ver] || '')
    + kv('Depth', p.depth ? `${depthText(+p.depth)}` : 'not stated') + kv('Road', (p.closed === true || p.closed === 'true') ? 'closed' : '') + kv('Reported', p.time ? ago(Date.parse(p.time)) : '')
    + (p.text ? `<div class="pp-note">${esc(p.text)}</div>` : ''),
  hospitals: p => title(nm(p) || 'Hospital (unnamed)', p.healthcare === 'clinic' ? 'Clinic' : 'Hospital') + kv('Emergency', p.emergency === 'yes' ? 'yes' : '') + kv('Operator', esc(p.operator || '')) + kv('Phone', esc(p.phone || p['contact:phone'] || '')) + kv('Hours', esc(p.opening_hours || '')),
  shelters: p => title(nm(p) || 'Unnamed site', p.emergency === 'assembly_point' ? 'Assembly point' : p.social_facility === 'shelter' ? 'Social shelter' : p.amenity === 'community_centre' ? 'Community centre' : 'Emergency shelter')
    + '<div class="pp-note">Possible gathering site from OpenStreetMap. Not an official evacuation list: check with the district office.</div>',
  pumping: p => { const t = WATER[p.man_made] || WATER[p.waterway] || 'Pumping / sluice / lock / weir', n = nm(p);
    return title(n || t, n ? t : (p.operator || p.pumping_station || p.water_works || 'Name not mapped in OSM')) + (n ? kv('Operator', esc(p.operator || '')) : ''); },
  piers: p => title(nm(p) || 'Ferry pier (unnamed)', p.amenity === 'ferry_terminal' ? 'Ferry terminal / boat stop' : p.man_made === 'pier' ? 'Pier' : 'Ferry stop') + kv('Operator', esc(p.operator || '')) + kv('Route', esc(p.route_ref || p.ref || '')) + kv('Thai name', esc(p['name:th'] || '')),
  parking: p => title(nm(p) || 'Car park (unnamed)', p.parking === 'underground' ? 'Car park, underground' : 'Car park, multi-storey') + kv('Capacity', esc(p.capacity || '')) + kv('Operator', esc(p.operator || '')) + kv('Fee', p.fee === 'yes' ? 'paid' : p.fee === 'no' ? 'free' : '')
    + '<div class="pp-note">From OpenStreetMap. Multi-storey and underground car parks can flood: check before parking.</div>',
  fire: p => title(nm(p) || 'Fire station (unnamed)', 'Fire / rescue station') + kv('Operator', esc(p.operator || '')) + kv('Phone', esc(p.phone || p['contact:phone'] || '')),
  landmarks: p => title(nm(p) || 'Landmark', [p.tourism, p.historic].filter(Boolean).join(' · ').replace(/_/g, ' ')) + kv('Wikipedia', esc(p.wikipedia || '')),
  raingrid: p => title('Rain cell', 'Open-Meteo forecast, 0.15 deg grid') + kv('This hour', `${p.mm} mm`) + kv('Next 3 h', `${p.n3} mm`) + kv('Next 6 h', `${p.n6} mm`) + kv('Next 24 h', `${p.n24} mm`),
  roads: p => title(p.label, p.hw ? `${p.hw} road` : '') + kv('Sedan', VERDICT(p.sedan)) + kv('Motorbike', VERDICT(p.motorbike)) + kv('Pickup', VERDICT(p.pickup)) + kv('Truck', VERDICT(p.truck))
    + kv('Depth', p.depthCm ? depthText(+p.depthCm) : '') + kv('Sources', esc(p.srcs || '')) + kv('Updated', p.updated ? ago(+p.updated) : ''),
  stations: p => title(nm(p) || 'Station', ({ sky:'Sky train station (BTS)', metro:'Metro station (MRT)', monorail:'Monorail station', people:'People mover station' })[p.lkind] || STATION[p.subclass] || 'Station') + kv('Thai name', esc(p['name:th'] || ''))
    + kv('Line', p.line ? `<span class="swd" style="background:${esc(p.lc || '#888')}"></span>${esc(p.line)}` : '') + kv('Operator', esc((p.lop || p.operator || '').split(';')[0]))
    + (Number(p.cm) >= 10 ? kv('Water within 500 m', `<b style="color:${DEPTHC(+p.cm)}">${depthText(+p.cm)}</b>`) : '')
    + (p.line ? '' : '<div class="pp-note">Not within 100 m of a metro or sky train line. Source: OpenFreeMap / OpenStreetMap.</div>'),
  'station-water': p => title(`${p.name}`, `${p.line || 'Station'} · water nearby`) + kv('Deepest report within 500 m', `<b style="color:${DEPTHC(+p.cm)}">${depthText(+p.cm)}</b>`) + kv('Depth points nearby', p.n)
    + '<div class="pp-note">Derived in the browser from Floodboard reports and road depths. It says water is near the station, not that the station is closed.</div>',
  raindist: p => title(`${p.name} district`, 'Open-Meteo at the district centre') + kv('Next 3 h', `${p.n3} mm`) + kv('Next 6 h', `${p.n6} mm`) + kv('Next 24 h', `${p.n24} mm`),
  rail: p => title(p.name || 'Railway line', p.subclass ? String(p.subclass).replace(/_/g, ' ') : 'rail') + kv('Ref', esc(p.ref || '')) + kv('Operator', esc(p.operator || ''))
    + kv('Structure', esc(p.brunnel || '')) + '<div class="pp-note">Source: OpenFreeMap / OpenStreetMap. Line names are not in the tile.</div>',
  transit: p => title(p.name || 'Transit line', ({ metro:'Metro line (MRT)', sky:'Sky train line (BTS)', monorail:'Monorail line', people:'Airport people mover' })[p.kind] || 'Transit line') + kv('Ref', esc(p.ref || '')) + kv('Operator', esc(p.operator || '')) + '<div class="pp-note">Source: OpenStreetMap.</div>',
  waterlevel: p => title(p.name, p.river ? `Water level station · ${p.river}` : 'Water level station')
    + kv('Level', p.pct >= 0 ? `<b style="color:${[C.wl0, C.wl1, C.wl2, C.wl3][p.band]}">${p.pct}% of bank</b>` : 'bank level unknown')
    + kv('Water surface', p.msl != null ? `${(+p.msl).toFixed(2)} m MSL` : '') + kv('Bank (lowest)', p.bank != null ? `${(+p.bank).toFixed(2)} m MSL` : '') + kv('Status level', p.situation !== '' ? `${p.situation} of 5` : '')
    + kv('Measured', esc(String(p.time).replace('T', ' '))) + '<div class="pp-note">ThaiWater, unconfirmed licence, prototype only. Gate stations follow the tide.</div>',
  canals: p => title(nm(p) || `Unnamed ${p.class}`, p.class === 'river' ? 'River' : 'Canal') + '<div class="pp-note">Source: OpenFreeMap / OpenStreetMap.</div>',
  ferry: () => title('Ferry route', 'Boat service') + '<div class="pp-note">Source: OpenFreeMap / OpenStreetMap. Check operator for service hours.</div>',
  airports: p => title(nm(p) || 'Airport', 'Airport') + kv('IATA', esc(p.iata || '')) + kv('ICAO', esc(p.icao || '')),
  'danger-grid': p => title(`${p.name} cell`, 'Derived from Floodboard roads and reports, plus Open-Meteo rain') + kv('Blocked roads', p.blocked) + kv('Risky roads', p.risky) + kv('Open reports', p.reports) + kv('Roads closed (reports)', p.closed) + kv('Rain next 6 h', p.rain6 ? `${p.rain6} mm` : '') + kv('Score', p.score),
  'districts-fill': p => title(`${p.name} district`, p.nameTh) + kv('Flood signals', `${p.signals} (open reports + risky/blocked roads)`) + kv('Population', p.population ? Number(p.population).toLocaleString('en') : ''),
  'depth-labels': p => title('Flood depth', p.text) + kv('Road', esc(p.road || '')) + kv('Depth', `${Math.round(p.cm)} cm`) + kv('Seen in', p.src === 'road' ? 'Floodboard road verdict' : 'live report'),
};
// Layer id -> popup key. Order = priority (points first, then lines, then areas).
// Sparse OSM / sensor points come before the thousand report dots so a hospital under a report is still clickable;
// the wide, soft rain-grid circles come last so they never swallow a click meant for a road or rail line.
const PICK = [['station-water','station-water'], ['raindist-label','raindist'], ['reports-cluster','cluster'], ['reports-cluster-count','cluster'], ['waterlevel','waterlevel'], ['waterlevel-label','waterlevel'], ['hospitals','hospitals'], ['hospitals-g','hospitals'], ['shelters','shelters'], ['shelters-g','shelters'],
  ['piers','piers'], ['piers-g','piers'], ['parking','parking'], ['parking-g','parking'], ['fire','fire'], ['fire-g','fire'], ['pumping','pumping'], ['pumping-g','pumping'], ['stations','stations'], ['stations-label','stations'], ['airports','airports'], ['airports-label','airports'],
  ['landmarks','landmarks'], ['landmarks-label','landmarks'], ['depth-dots','depth-labels'], ['depth-labels','depth-labels'], ['reports','reports'], ['roads','roads'], ['roads-ok','roads'], ['roads-hit','roads'],
  ['transit','transit'], ['rail','rail'], ['ferry','ferry'], ['canals','canals'], ['danger-grid','danger-grid'], ['raingrid','raingrid'], ['districts-fill','districts-fill']];
const NOHOVER = new Set(['danger-grid', 'districts-fill', 'raingrid']);

// Shared popup wiring; 3D may import this (missing layer ids are skipped).
export function bindPopups(map) {
  const pop = new maplibregl.Popup({ closeButton:false, closeOnClick:false, maxWidth:'300px', className:'pp' }) // closeOnClick:false: the built-in close ran after our handler and killed every second popup;
  const live = pick => pick.filter(([id]) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  const box = (e, r) => [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]];
  map.on('click', e => {
    const ids = live(PICK), hits = ids.length ? map.queryRenderedFeatures(box(e, 9), { layers: ids.map(x => x[0]) }) : [];
    for (const [id, key] of ids) {
      const f = hits.find(h => h.layer.id === id); if (!f) continue;
      if (key === 'cluster') { // zoom into the cluster instead of opening a popup
        pop.remove(); const c = f.geometry.coordinates;
        Promise.resolve(map.getSource('reports').getClusterExpansionZoom(f.properties.cluster_id)).then(z => map.easeTo({ center:c, zoom:Math.min(16, (z ?? map.getZoom()) + .3) })).catch(() => map.easeTo({ center:c, zoom:map.getZoom() + 1.5 }));
        return;
      }
      let html; try { html = POPUPS[key](f.properties || {});
        if (key === 'danger-grid') { const rg = hits.find(h => h.layer.id === 'raingrid'); if (rg) html += POPUPS.raingrid(rg.properties || {}); } } catch (err) { warnOnce(`popup-${id}`, `popup ${id}: ${err.message}`); html = title(id, 'No details'); }
      pop.setLngLat(f.geometry.type === 'Point' ? f.geometry.coordinates : e.lngLat).setHTML(`<div class="pp-body">${html}</div>`).addTo(map); return;
    }
    pop.remove();
  });
  map.on('mousemove', e => {
    const ids = live(PICK).filter(([id]) => !NOHOVER.has(id)).map(x => x[0]);
    map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(box(e, 5), { layers: ids }).length ? 'pointer' : '';
  });
}

// ---------- layers ----------
const glyphLayer = (id, src, glyph, color = '#ffffff', mz = 11.5) => ({ id:`${id}-g`, type:'symbol', source:src, minzoom:mz,
  layout:{ 'text-field':glyph, 'text-font':['Noto Sans Bold'], 'text-size':['interpolate',['linear'],['zoom'],mz,9,14,12,16,14], 'text-allow-overlap':true, 'text-ignore-placement':true },
  paint:{ 'text-color':color } });
const dotLayer = (id, src, color, minzoom, big = 1) => ({ id, type:'circle', source:src, minzoom,
  paint:{ 'circle-opacity':['interpolate',['linear'],['zoom'],minzoom,.35,minzoom+1,1], 'circle-radius':['interpolate',['linear'],['zoom'],10,2.8*big,12,6.5*big,16,12*big], 'circle-color':color, 'circle-stroke-color':'#ffffff', 'circle-stroke-width':['interpolate',['linear'],['zoom'],10,.6,12,1.2] } });
const empty = { type:'FeatureCollection', features:[] };
const OSMT = 'openmaptiles';
const NAME = ['coalesce', ['get','name_en'], ['get','name:en'], ['get','name:latin'], ['get','name']];

// Marks a toggle as unavailable / adds its count once the lazy data lands (touches only the checkbox label).
function annotate(key, text, disable) {
  const l = LAYERS2D.find(x => x.key === key), cb = l && document.querySelector(`input[data-l="${l.ids.join(',')}"]`);
  if (!cb || cb.parentElement.querySelector('.ann')) return;
  if (disable) { cb.disabled = true; cb.checked = false; l.ids.forEach(id => window.__map?.getLayer(id) && window.__map.setLayoutProperty(id, 'visibility', 'none')); }
  cb.parentElement.append(Object.assign(document.createElement('span'), { className:'dim ann', textContent:` ${text}` }));
}

const KEYS = { fireStations:'fire' };
function lazyPoints(map, key, src, glyph) {
  map.addSource(src, { type:'geojson', data:empty });
  return loadPoints(key).then(fc => {
    if (!fc) return annotate(KEYS[key] || key, '(unavailable)', true);
    const feats = fc.features.map(f => ({ ...f, properties: { ...f.properties, g: glyph } }));
    map.getSource(src)?.setData({ type:'FeatureCollection', features:feats });
    annotate(KEYS[key] || key, `(${feats.length})`);
  });
}

// Nine-slice pill used behind map chips (icon-text-fit stretches it to the text).
function addChip(map, id, fill, stroke) {
  if (map.hasImage(id)) return;
  const S = 32, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'); g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = 2;
  g.beginPath(); g.roundRect(1.5, 1.5, S - 3, S - 3, 14); g.fill(); g.stroke();
  map.addImage(id, g.getImageData(0, 0, S, S), { pixelRatio:2, stretchX:[[14, 18]], stretchY:[[14, 18]], content:[12, 12, 20, 20] });
}

export function addLayers2D(map, d) {
  addChip(map, 'chip-water', 'rgba(8,36,64,.94)', '#38bdf8'); addChip(map, 'chip-rain', 'rgba(24,32,48,.94)', '#94a3b8');
  const L = map.getStyle().layers.map(l => l.id), firstRoad = L.includes('highway_path') ? 'highway_path' : undefined;
  const labelLayer = L.includes('highway_name_other') ? 'highway_name_other' : L.find(id => map.getLayer(id)?.type === 'symbol');
  // core layers are added synchronously; lazy data (snapshot / Open-Meteo) fills in after first paint
  loadDistricts(d); ['landmarks', 'hospitals', 'shelters', 'pumping', 'fireStations', 'piers', 'parking'].forEach(loadPoints); loadForecastGrid();

  // polygons under the basemap roads: danger hexes, then district outlines
  map.addSource('districts', { type:'geojson', data:empty });
  map.addSource('district-labels', { type:'geojson', data:empty });
  map.addSource('danger', { type:'geojson', data:dangerGrid(d, null) });
  map.addLayer({ id:'districts-fill', type:'fill', source:'districts', paint:{ 'fill-color':['step',['get','signals'],'rgba(0,0,0,0)',1,'rgba(250,204,21,.05)',12,'rgba(251,146,60,.11)',40,'rgba(239,68,68,.17)'] } }, firstRoad);
  map.addLayer({ id:'districts-line', type:'line', source:'districts', paint:{ 'line-color':'#5b6b7c', 'line-width':['interpolate',['linear'],['zoom'],9,.6,13,1.4], 'line-dasharray':[3,2], 'line-opacity':.8 } }, firstRoad);
  map.addLayer({ id:'danger-grid', type:'fill', source:'danger', paint:{ 'fill-color':['match',['get','level'],3,DG[3],2,DG[2],DG[1]] } }, firstRoad);
  map.addLayer({ id:'danger-grid-line', type:'line', source:'danger', paint:{ 'line-color':['match',['get','level'],3,'rgba(239,68,68,.85)',2,'rgba(251,146,60,.7)','rgba(56,189,248,.55)'], 'line-width':['interpolate',['linear'],['zoom'],9,.8,13,1.6] } }, firstRoad);

  // radar: above basemap roads, below labels
  if (d.frames.length) {
    const cur = d.frames.findLast(f => !f.nowcast) || d.frames[0];
    map.addSource('radar', { type:'raster', tiles:[cur.url], tileSize:256, maxzoom:7 });
    map.addLayer({ id:'radar', type:'raster', source:'radar', paint:{ 'raster-opacity':.7, 'raster-fade-duration':0, 'raster-resampling':'linear' } }, labelLayer);
  } else warnOnce('radar-none', 'no radar frames'), setTimeout(() => annotate('radar', '(unavailable)', true));

  // rain forecast grid (filled by the timeline / lazily)
  map.addSource('raingrid', { type:'geojson', data:empty });
  map.addLayer({ id:'raingrid', type:'circle', source:'raingrid', filter:['!=',['get','cls'],'dry'], paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],9,28,12,70,14,120], 'circle-blur':.9,
    'circle-color':['match',['get','cls'],'soon',C.rain,'later',C.later,'rgba(0,0,0,0)'], 'circle-opacity':['match',['get','cls'],'soon',.38,'later',.3,0] } });
  map.addLayer({ id:'raingrid-label', type:'symbol', source:'raingrid', filter:['!=',['get','cls'],'dry'], minzoom:9, maxzoom:11.2,
    layout:{ 'text-field':['get','label'], 'text-font':['Noto Sans Regular'], 'text-size':10, 'text-allow-overlap':false, 'text-padding':8, 'text-offset':[0,2.4], 'symbol-sort-key':50 },
    paint:{ 'text-color':'#cbd5e1', 'text-halo-color':'#0b0f14', 'text-halo-width':3 } });
  loadForecastGrid().then(g => {
    if (!g) return annotate('raingrid', '(unavailable)', true);
    window.__rainGrid = g; setRainGrid(map, g, d, 0);
    map.getSource('danger')?.setData(dangerGrid(d, g));
  });

  // rail, stations, airports straight from the OpenFreeMap tiles (no extra request)
  // canals / rivers (named waterway lines, brighter than the dark basemap) and ferry routes; under the basemap roads
  map.addLayer({ id:'canals', type:'line', source:OSMT, 'source-layer':'waterway', minzoom:9, filter:['in',['get','class'],['literal',['river','canal']]],
    layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':C.canal, 'line-opacity':['interpolate',['linear'],['zoom'],9,.45,12,.8], 'line-width':['interpolate',['linear'],['zoom'],9,.8,12,1.8,15,4] } }, firstRoad);
  map.addLayer({ id:'canals-label', type:'symbol', source:OSMT, 'source-layer':'waterway', minzoom:12, filter:['all',['in',['get','class'],['literal',['river','canal']]],['has','name']],
    layout:{ 'symbol-placement':'line', 'text-field':NAME, 'text-font':['Noto Sans Italic'], 'text-size':11, 'symbol-spacing':320 },
    paint:{ 'text-color':'#a5f3fc', 'text-halo-color':'#0b0f14', 'text-halo-width':1.5 } });
  map.addLayer({ id:'ferry', type:'line', source:OSMT, 'source-layer':'transportation', minzoom:9, filter:['==',['get','class'],'ferry'],
    paint:{ 'line-color':C.ferry, 'line-width':['interpolate',['linear'],['zoom'],9,1.5,13,3], 'line-dasharray':[4,2.5] } });

  // rail lines from the tiles (dashed, by subclass). OpenFreeMap has no metro / sky train line geometry for Bangkok, so
  // those come from an optional OSM snapshot (osm-snapshot/transit.json, see loadTransitLines) and stay empty until it exists.
  map.addLayer({ id:'rail', type:'line', source:OSMT, 'source-layer':'transportation', minzoom:8,
    filter:['all', ['==',['get','class'],'rail'], ['!',['has','service']]],
    paint:{ 'line-color':['match',['get','subclass'],'subway',C.metro,'light_rail',C.sky,'monorail',C.sky,C.rail], 'line-width':['interpolate',['linear'],['zoom'],8,1,12,2.2,16,4], 'line-dasharray':[3,2.5], 'line-opacity':.85 } });
  map.addSource('transit-lines', { type:'geojson', data:empty });
  map.addLayer({ id:'transit', type:'line', source:'transit-lines', minzoom:8,
    paint:{ 'line-color':['case',['!=',['get','color'],''],['get','color'],['==',['get','kind'],'metro'],C.metro,C.sky], 'line-width':['interpolate',['linear'],['zoom'],8,1.6,12,3.2,16,5], 'line-opacity':.95 } });
  loadTransitLines().then(fc => { if (!fc) return; map.getSource('transit-lines')?.setData(fc); transitFc = fc; stationsRefresh(true); });
  const stationFilter = ['all', ['==',['get','class'],'railway'], ['in',['get','subclass'],['literal',['station','halt','subway','light_rail','monorail','tram']]]];
  const subColor = sc => ({ subway:C.metro, light_rail:C.sky, monorail:C.sky, tram:C.sky })[sc] || '#e5e7eb';
  map.addSource('stations-src', { type:'geojson', data:empty });
  map.addSource('station-water-src', { type:'geojson', data:empty });
  map.addLayer({ id:'stations', type:'circle', source:'stations-src', minzoom:9.8,
    paint:{ 'circle-radius':['interpolate',['linear'],['zoom'],9.8,2.6,13,5.5,16,8], 'circle-color':['get','lc'], 'circle-stroke-color':'#0b0f14', 'circle-stroke-width':['interpolate',['linear'],['zoom'],10.5,1,14,2] } });
  map.addLayer({ id:'stations-label', type:'symbol', source:'stations-src', minzoom:12.5,
    layout:{ 'text-field':['get','name'], 'text-font':['Noto Sans Regular'], 'text-size':11, 'text-anchor':'top', 'text-offset':[0,.8], 'text-max-width':8 },
    paint:{ 'text-color':['get','lc'], 'text-halo-color':'#0b0f14', 'text-halo-width':1.6 } });
  // stations: collected from the loaded poi tiles as the map moves, snapped to the nearest transit line (<= 100 m) for name + colour
  const stations = new Map(); let transitFc = null, depthFc = depthPoints(d);
  const waterRefresh = () => {
    const dp = depthFc.features.map(f => ({ c:f.geometry.coordinates, cm:f.properties.cm })), out = [];
    for (const st of stations.values()) {
      const c = st.geometry.coordinates; let cm = 0, n = 0;
      for (const q of dp) { if (Math.abs(q.c[0] - c[0]) > .006 || Math.abs(q.c[1] - c[1]) > .006 || distM(c, q.c) > 500) continue; n++; cm = Math.max(cm, q.cm); }
      if (cm >= 10 && st.properties.name) out.push({ type:'Feature', geometry:{ type:'Point', coordinates:c }, properties:{ name:st.properties.name, line:st.properties.line || '', cm:Math.round(cm), n, text:`${st.properties.name} · ${Math.round(cm)} cm` } });
    }
    map.getSource('station-water-src')?.setData({ type:'FeatureCollection', features:out });
    if (out.length) annotate('rail', `(${out.length} stations with water)`);
  };
  let stTimer = 0;
  const stationsRefresh = (resnap = false) => {
    if (!map.getSource('openmaptiles')) return;
    let grew = false, feats = [];
    try { feats = map.querySourceFeatures(OSMT, { sourceLayer:'poi', filter:stationFilter }); } catch (e) { warnOnce('stations-q', `stations query failed: ${e.message}`); }
    for (const f of feats) {
      const p = f.properties, name = p.name_en || p['name:en'] || p['name:latin'] || p.name || '', c = f.geometry.coordinates, k = `${name}|${c[0].toFixed(4)},${c[1].toFixed(4)}`;
      if (stations.has(k)) continue; grew = true;
      stations.set(k, { type:'Feature', geometry:{ type:'Point', coordinates:c }, properties:{ ...p, name, lc:subColor(p.subclass) } });
    }
    if (!grew && !resnap) return;
    for (const st of stations.values()) { const sn = snapToTransit(transitFc, ...st.geometry.coordinates, 100);
      st.properties = { ...st.properties, line: sn?.line || '', lop: sn?.operator || '', lkind: sn?.kind || '', lc: sn?.color || subColor(st.properties.subclass) }; }
    map.getSource('stations-src')?.setData({ type:'FeatureCollection', features:[...stations.values()] });
    waterRefresh();
  };
  const later = () => { clearTimeout(stTimer); stTimer = setTimeout(() => stationsRefresh(), 250); };
  map.on('moveend', later); map.on('sourcedata', e => { if (e.sourceId === OSMT && e.isSourceLoaded) later(); }); map.once('idle', () => stationsRefresh());
  map.addLayer({ id:'airports', type:'circle', source:OSMT, 'source-layer':'aerodrome_label', minzoom:8,
    paint:{ 'circle-radius':['interpolate',['linear'],['zoom'],8,4,13,8], 'circle-color':C.airport, 'circle-stroke-color':'#0b0f14', 'circle-stroke-width':1.5 } });
  map.addLayer({ id:'airports-label', type:'symbol', source:OSMT, 'source-layer':'aerodrome_label', minzoom:9,
    layout:{ 'text-field':NAME, 'text-font':['Noto Sans Regular'], 'text-size':12, 'text-anchor':'top', 'text-offset':[0,1], 'text-max-width':9 },
    paint:{ 'text-color':C.airport, 'text-halo-color':'#0b0f14', 'text-halo-width':1.8 } });

  // flooded roads: passable stays dim and thin, risky/blocked get a strong glow, worst on top
  map.addSource('roads', { type:'geojson', data:d.roads });
  map.addLayer({ id:'roads-hit', type:'line', source:'roads', layout:{ 'line-cap':'round' }, paint:{ 'line-color':'#000000', 'line-opacity':.01, 'line-width':18 } });
  map.addLayer({ id:'roads-ok', type:'line', source:'roads', filter:['==',['get','sev'],1], layout:{ 'line-cap':'round' },
    paint:{ 'line-color':C.ok, 'line-width':['interpolate',['linear'],['zoom'],9,1,12,2,16,5], 'line-opacity':.22 } });
  map.addLayer({ id:'roads-glow', type:'line', source:'roads', filter:['>=',['get','sev'],3], layout:{ 'line-sort-key':['get','sev'] },
    paint:{ 'line-color':COLOR, 'line-width':['interpolate',['linear'],['zoom'],9,16,12,24,15,38], 'line-blur':8, 'line-opacity':.85 } });
  map.addLayer({ id:'roads', type:'line', source:'roads', filter:['>=',['get','sev'],2], layout:{ 'line-cap':'round', 'line-join':'round', 'line-sort-key':['get','sev'] },
    paint:{ 'line-color':COLOR, 'line-width':['interpolate',['linear'],['zoom'],9,5,11,6,13,7.5,16,11], 'line-opacity':1 } });

  // OSM points (snapshot-backed): landmarks under the safety classes
  map.addSource('landmarks', { type:'geojson', data:empty });
  map.addLayer({ id:'landmarks', type:'circle', source:'landmarks', minzoom:11.5,
    paint:{ 'circle-radius':['interpolate',['linear'],['zoom'],11,2.5,14,4.5,16,6], 'circle-color':C.landmark, 'circle-stroke-color':'#0b0f14', 'circle-stroke-width':1 } });
  map.addLayer({ id:'landmarks-label', type:'symbol', source:'landmarks', minzoom:12.5,
    layout:{ 'text-field':['coalesce',['get','name:en'],['get','name']], 'text-font':['Noto Sans Regular'], 'text-size':11, 'text-anchor':'top', 'text-offset':[0,.7], 'text-max-width':8, 'text-optional':true },
    paint:{ 'text-color':'#ddd6fe', 'text-halo-color':'#0b0f14', 'text-halo-width':1.6 } });
  loadPoints('landmarks').then(fc => { if (!fc) return annotate('landmarks', '(unavailable)', true);
    map.getSource('landmarks')?.setData(fc); annotate('landmarks', `(${fc.features.length})`); });
  lazyPoints(map, 'pumping', 'pumping', 'P');
  map.addLayer(dotLayer('pumping', 'pumping', C.pump, 10.3)); map.addLayer(glyphLayer('pumping', 'pumping', ['get','g'], '#ffffff', 11));
  lazyPoints(map, 'piers', 'piers', 'B');
  map.addLayer(dotLayer('piers', 'piers', C.ferry, 11.5)); map.addLayer(glyphLayer('piers', 'piers', ['get','g'], '#0b0f14', 12.2));
  lazyPoints(map, 'parking', 'parking', 'P');
  map.addLayer(dotLayer('parking', 'parking', C.park, 12)); map.addLayer(glyphLayer('parking', 'parking', ['get','g'], '#ffffff', 12.5));
  lazyPoints(map, 'fireStations', 'fire', 'F');
  map.addLayer(dotLayer('fire', 'fire', C.fire, 10.3, 1.1)); map.addLayer(glyphLayer('fire', 'fire', ['get','g'], '#0b0f14', 11));
  lazyPoints(map, 'shelters', 'shelters', 'S');
  map.addLayer(dotLayer('shelters', 'shelters', C.shelter, 9.5)); map.addLayer(glyphLayer('shelters', 'shelters', ['get','g'], '#ffffff', 10.5));
  lazyPoints(map, 'hospitals', 'hospitals', 'H');
  map.addLayer(dotLayer('hospitals', 'hospitals', C.hospital, 12.5, 1.1)); map.addLayer(glyphLayer('hospitals', 'hospitals', ['get','g'], '#ffffff', 13));

  // water level sensors (ThaiWater, % of bank): ring-style dots with a % label
  map.addSource('waterlevel', { type:'geojson', data:d.water || empty });
  map.addLayer({ id:'waterlevel', type:'circle', source:'waterlevel', paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],9,4.5,12,8,15,11], 'circle-color':['match',['get','band'],1,C.wl1,2,C.wl2,3,C.wl3,C.wl0],
    'circle-stroke-color':'#ffffff', 'circle-stroke-width':2, 'circle-opacity':1 } });
  map.addLayer({ id:'waterlevel-label', type:'symbol', source:'waterlevel', minzoom:10.5, filter:['!=',['get','label'],''],
    layout:{ 'text-field':['get','label'], 'text-font':['Noto Sans Bold'], 'text-size':['interpolate',['linear'],['zoom'],10.5,11,14,13], 'text-anchor':'left', 'text-offset':[1.1,0], 'text-allow-overlap':false, 'text-padding':3 },
    paint:{ 'text-color':['match',['get','band'],3,'#fecdd3',2,'#fde68a','#99f6e4'], 'text-halo-color':'#0b0f14', 'text-halo-width':2 } });
  if (!(d.water?.features.length)) setTimeout(() => annotate('waterlevel', '(unavailable)', true));

  // live reports on top of points: clustered below z13; single reports styled by tier (filled = verified, hollow ring = unverified, purple ring = Traffy)
  map.addSource('reports', { type:'geojson', data:d.reports, cluster:true, clusterRadius:40, clusterMaxZoom:12,
    clusterProperties:{ closed:['+',['case',['get','closed'],1,0]], verified:['+',['case',['==',['get','ver'],'verified'],1,0]] } });
  map.addLayer({ id:'reports-cluster', type:'circle', source:'reports', filter:['has','point_count'], paint:{
    'circle-radius':['step',['get','point_count'],12,10,15,40,19,120,24,300,29], 'circle-color':'#0e3a5c', 'circle-opacity':.92,
    'circle-stroke-color':['case',['>',['get','closed'],0],C.blocked,C.rain], 'circle-stroke-width':2.2 } });
  map.addLayer({ id:'reports-cluster-count', type:'symbol', source:'reports', filter:['has','point_count'],
    layout:{ 'text-field':['get','point_count_abbreviated'], 'text-font':['Noto Sans Bold'], 'text-size':12, 'text-allow-overlap':true, 'text-ignore-placement':true },
    paint:{ 'text-color':'#ffffff' } });
  map.addLayer({ id:'reports', type:'circle', source:'reports', filter:['!',['has','point_count']], paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],9,['interpolate',['linear'],['get','depth'],0,2.2,100,4],11,['interpolate',['linear'],['get','depth'],0,3.2,100,6.5],13,['interpolate',['linear'],['get','depth'],0,4.5,100,10]],
    'circle-color':['case',['get','closed'],C.blocked,['==',['get','ver'],'verified'],C.rain,'rgba(11,15,20,.25)'],
    'circle-stroke-color':['case',['get','closed'],'#fecaca',['==',['get','ver'],'traffy'],C.traffy,['==',['get','ver'],'verified'],'#0b0f14','#7dd3fc'],
    'circle-stroke-width':['case',['get','closed'],1.2,['==',['get','ver'],'verified'],1,2], 'circle-opacity':['interpolate',['linear'],['zoom'],9,.7,12,1], 'circle-stroke-opacity':1 } });

  // depth words on reports and roads that state a depth
  map.addSource('depth', { type:'geojson', data:depthPoints(d) });
  map.addLayer({ id:'depth-dots', type:'circle', source:'depth', minzoom:9.8, paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],9.8,['interpolate',['linear'],['get','cm'],0,3.5,150,6],13,['interpolate',['linear'],['get','cm'],0,5,150,9]],
    'circle-color':'rgba(11,15,20,.55)', 'circle-stroke-color':['step',['get','cm'],'#7dd3fc',35,'#facc15',70,'#fb923c',120,'#ef4444'], 'circle-stroke-width':2.4 } });
  map.addLayer({ id:'depth-labels', type:'symbol', source:'depth', minzoom:9.8,
    layout:{ 'text-field':['get','text'], 'text-font':['Noto Sans Bold'], 'text-size':['interpolate',['linear'],['zoom'],9.8,10,15,13], 'text-anchor':'left', 'text-offset':[1.15,0], 'text-max-width':12,
      'symbol-sort-key':['-',0,['get','cm']] },
    paint:{ 'text-color':['case',['==',['get','deep'],1],'#fecaca','#e6edf3'], 'text-halo-color':'#0b0f14', 'text-halo-width':2 } });

  // chips (station water, district rain) sit above every point layer
  map.addLayer({ id:'station-water', type:'symbol', source:'station-water-src', minzoom:10.3,
    layout:{ 'text-field':['get','text'], 'text-font':['Noto Sans Bold'], 'text-size':11, 'text-anchor':'bottom', 'text-offset':[0,-1.1], 'text-padding':4, 'symbol-sort-key':['-',0,['get','cm']],
      'text-max-width':40, 'icon-image':'chip-water', 'icon-text-fit':'both', 'icon-text-fit-padding':[2,7,2,7], 'icon-allow-overlap':false, 'text-optional':false },
    paint:{ 'text-color':'#e0f2fe' } });
  // district names on top
  map.addLayer({ id:'districts-label', type:'symbol', source:'district-labels', minzoom:10.6,
    layout:{ 'text-field':['get','name'], 'text-font':['Noto Sans Regular'], 'text-size':['interpolate',['linear'],['zoom'],10,9,13,13], 'text-transform':'uppercase', 'text-letter-spacing':.08, 'text-max-width':7 },
    paint:{ 'text-color':'#cbd5e1', 'text-opacity':.7, 'text-halo-color':'#0b0f14', 'text-halo-width':1.8 } });
  // named rain chips at district centres (Open-Meteo, one batched call); above the district names so the chip wins the collision
  map.addSource('raindist', { type:'geojson', data:empty });
  map.addLayer({ id:'raindist-label', type:'symbol', source:'raindist', minzoom:11.2, maxzoom:12.3,
    layout:{ 'text-field':['get','label'], 'text-font':['Noto Sans Bold'], 'text-size':['interpolate',['linear'],['zoom'],11.2,9.5,14,11.5], 'text-padding':2, 'symbol-sort-key':['-',0,['get','n6']],
      'icon-image':'chip-rain', 'icon-text-fit':'both', 'icon-text-fit-padding':[1,5,1,5], 'text-max-width':20, 'text-allow-overlap':false, 'icon-allow-overlap':false },
    paint:{ 'text-color':'#e2e8f0' } }, 'depth-dots');
  loadDistricts(d).then(async r => {
    if (!r) return annotate('districts', '(unavailable)', true);
    loadDistrictRain(r.labels).then(rows => { if (rows) { window.__distRain = rows; setDistrictRain(map, rows, d, 0); } });
    map.getSource('districts')?.setData(r.polys); map.getSource('district-labels')?.setData(r.labels);
    annotate('districts', `(${r.polys.features.length})`);
  });

  bindPopups(map);
}

// ---------- rain grid at a given hour offset from "now" ----------
function nowIndex(g, d) { const t = d.wx.current.time.slice(0, 13); const i = g[0].time.findIndex(x => x >= t); return i < 0 ? 0 : i; }
const sum = (a, i, n) => +a.slice(i, i + n).reduce((x, y) => x + y, 0).toFixed(1);
function setRainGrid(map, g, d, offsetH) {
  const i0 = nowIndex(g, d), i = Math.min(i0 + offsetH, g[0].time.length - 1);
  const feats = g.map(p => {
    const mm = +(p.mm[i] ?? 0).toFixed(1), n3 = sum(p.mm, i0, 3), n6 = sum(p.mm, i0, 6), n24 = sum(p.mm, i0, 24);
    let cls, label;
    if (offsetH > 0) { cls = mm >= 0.3 ? 'soon' : 'dry'; label = `${mm} mm/h`; }
    else if (n6 >= 0.5) { cls = 'soon'; label = `rain soon ${Math.round(n6)} mm`; }
    else if (n24 >= 1) { cls = 'later'; label = `rain later ${Math.round(n24)} mm`; }
    else { cls = 'dry'; label = 'dry'; }
    return { type:'Feature', geometry:{ type:'Point', coordinates:[p.lon, p.lat] }, properties:{ cls, label, mm, n3, n6, n24 } };
  });
  map.getSource('raingrid')?.setData({ type:'FeatureCollection', features:feats });
}

// District rain chips at a given hour offset; offset 0 = sums over the next 6 / 24 h.
const fmtMm = n => n < 10 ? +n.toFixed(1) : Math.round(n);
function setDistrictRain(map, rows, d, offsetH) {
  const feats = [];
  for (const p of rows) {
    const i0 = nowIndex([p], d), i = Math.min(i0 + offsetH, p.time.length - 1), n3 = sum(p.mm, i0, 3), n6 = sum(p.mm, i0, 6), n24 = sum(p.mm, i0, 24), mm = +(p.mm[i] ?? 0).toFixed(1);
    let label;
    if (offsetH > 0) { if (mm < .3) continue; label = `${p.name} · rain ${mm} mm/h`; }
    else if (n6 >= 1) label = `${p.name} · rain ${fmtMm(n6)} mm in 6 h`;
    else continue;
    feats.push({ type:'Feature', geometry:{ type:'Point', coordinates:[p.lon, p.lat] }, properties:{ name:p.name, label, n3, n6: offsetH > 0 ? mm : n6, n24 } });
  }
  map.getSource('raindist')?.setData({ type:'FeatureCollection', features:feats });
}

// ---------- radar scrubber + 60 h rain chart ----------
export function mountTimeline(el, map, d) {
  const frames = d.frames.slice(), radarN = frames.length, latest = Math.max(0, frames.findLastIndex(f => !f.nowcast));
  el.innerHTML = `<div class="tl-radar">
      <div class="tl-head"><b>Rain radar</b><span class="tl-time" id="ft">…</span></div>
      <div class="tl-kind" id="fk"></div>
      <div class="tl-track"><input type="range" id="fr" min="0" max="${Math.max(0, frames.length - 1)}" value="${latest}" ${frames.length ? '' : 'disabled'} aria-label="Radar time"><i class="tl-split" id="fs" title="latest observed frame"></i></div>
      <div class="tl-ends dim"><span id="fa"></span><span class="tl-nowlab" id="fn">now</span><span id="fb"></span></div>
      <div class="tl-key dim"><span><i class="k obs"></i>observed</span><span><i class="k fc"></i>forecast</span><span class="tl-btns"><button id="play" ${frames.length ? '' : 'disabled'}>Play</button><button id="nowb" ${frames.length ? '' : 'disabled'}>Latest</button></span></div>
      <div class="tl-int"><span class="dim">Intensity</span><span class="ramp"><em>light</em><em>moderate</em><em>heavy</em></span></div>
      <div class="tl-note">Coloured areas are rainfall, not standing water.</div>
    </div>
    <div class="tl-chart"><div class="tl-head"><b>Rain at Bangkok centre</b><span class="dim">past 12 h, next 48 h · bars: mm/h (left) · line: chance % (right)</span></div><div id="chartwrap"></div></div>`;
  const fr = el.querySelector('#fr'), ft = el.querySelector('#ft'), fk = el.querySelector('#fk'), play = el.querySelector('#play');
  const label = f => ({ radar:`radar, observed`, nowcast:`radar nowcast`, model:`model forecast (Open-Meteo, 3x3 grid)` })[f.kind];
  const ends = () => { 
    const fc = frames.some(f => f.kind === 'model' || f.kind === 'nowcast');
    const back = frames.length ? Math.round((frames[latest].time - frames[0].time) / 3600) : 0;
    el.querySelector('#fa').textContent = frames.length ? `${hhmm(frames[0].time)} observed (-${back} h)` : ''; el.querySelector('#fb').textContent = frames.length ? (fc ? `forecast to ${hhmm(frames.at(-1).time)}` : `${hhmm(frames.at(-1).time)} observed`) : ''; el.querySelector('#fn').style.display = frames.length > radarN ? 'block' : 'none'; };
  let markX = () => {};
  const show = i => {
    const f = frames[i]; if (!f) { ft.textContent = 'radar unavailable'; return; }
    const fcst = f.kind !== 'radar';
    ft.innerHTML = `${hhmm(f.time)} Bangkok <small class="bd ${fcst ? 'fc' : 'obs'}">${fcst ? 'forecast' : 'observed'}</small>`;
    fk.className = `tl-kind ${fcst ? 'fc' : ''}`;
    fk.textContent = `${fcst ? 'FORECAST: ' : ''}${label(f)}${i === latest ? ' · latest observed frame' : ''}${f.kind === 'model' ? ` · +${f.offset} h from now` : ''}`;
    if (f.kind === 'model') { map.getLayer('radar') && map.setPaintProperty('radar', 'raster-opacity', 0); window.__rainGrid && setRainGrid(map, window.__rainGrid, d, f.offset); window.__distRain && setDistrictRain(map, window.__distRain, d, f.offset); }
    else { map.getSource('radar')?.setTiles([f.url]); map.getLayer('radar') && map.setPaintProperty('radar', 'raster-opacity', .7); window.__rainGrid && setRainGrid(map, window.__rainGrid, d, 0); window.__distRain && setDistrictRain(map, window.__distRain, d, 0); }
    markX(f.time);
    const pct = 100 * (radarN ? (radarN - 1) / Math.max(1, frames.length - 1) : 0);
    fr.style.setProperty('--obs', `${pct}%`); el.querySelector('#fs').style.left = `${pct}%`; el.querySelector('#fn').style.left = `${pct}%`; el.querySelector('#fs').style.display = frames.length > radarN ? 'block' : 'none';
  };
  fr.oninput = () => { stop(); show(+fr.value); };
  let timer = 0; const stop = () => { clearInterval(timer); timer = 0; play.textContent = 'Play'; };
  play.onclick = () => {
    if (timer) return stop();
    let i = +fr.value >= frames.length - 1 ? 0 : +fr.value; play.textContent = 'Pause';
    timer = setInterval(() => { fr.value = i; show(i); if (++i >= frames.length) stop(); }, 650);
  };
  el.querySelector('#nowb').onclick = () => { stop(); fr.value = latest; show(latest); };
  ends(); map.once('idle', () => show(+fr.value)); if (map.loaded()) show(+fr.value);

  // extend the scrubber with +1..+6 h modelled frames: radar nowcast is not in the free feed
  loadForecastGrid().then(g => {
    if (!g) return;
    const base = frames.length ? frames[latest].time : Math.floor(Date.now() / 1000);
    const hr = Math.ceil(base / 3600) * 3600;
    for (let k = 1; k <= 6; k++) frames.push({ kind:'model', time: hr + (k - 1) * 3600, offset:k });
    fr.max = frames.length - 1; fr.disabled = false; play.disabled = false; el.querySelector('#nowb').disabled = false; ends(); show(+fr.value);
  });

  drawChart(el.querySelector('#chartwrap'), d, fn => { markX = fn; });
  drawFlow(map);
}

// River discharge (Open-Meteo Flood API): current and forecast m3/s as small sparklines, 7 d back + 14 d ahead.
function drawFlow(map) {
  const host = map.getContainer().parentElement; host.querySelector('.flowcard')?.remove();
  const wrap = Object.assign(document.createElement('details'), { className:'flowcard', open:true });
  wrap.innerHTML = '<summary>River discharge <span class="dim">m³/s</span></summary><div class="fl-sub dim">7 d back (solid) · 14 d ahead (dashed) · modelled, Open-Meteo Flood API</div><div class="fl-rows dim">loading…</div>';
  host.append(wrap);
  const rows = wrap.querySelector('.fl-rows');
  loadDischarge().then(pts => {
    if (!pts?.length) { rows.textContent = 'River discharge unavailable'; return; }
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), fmt = v => v >= 100 ? Math.round(v).toLocaleString('en') : v.toFixed(1);
    rows.className = 'fl-rows';
    rows.innerHTML = pts.map(p => {
      const ni = Math.max(0, p.days.indexOf(today)), now = p.q[ni], end = p.q.at(-1), W = 84, H = 24, mx = Math.max(...p.q, 1), mn = Math.min(...p.q, 0);
      const X = i => 2 + i * (W - 4) / (p.q.length - 1), Y = v => H - 3 - (v - mn) / (mx - mn || 1) * (H - 8);
      const line = p.q.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' '), fc = p.q.slice(ni).map((v, i) => `${X(ni + i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      const trend = end > now * 1.05 ? 'rising' : end < now * .95 ? 'falling' : 'steady';
      return `<div class="fl-row"><span class="fl-n">${esc(p.name)}</span><svg width="${W}" height="${H}" role="img" aria-label="${esc(p.name)} discharge"><polyline fill="none" stroke="#3f7ea3" stroke-width="1.5" points="${line}"/><polyline fill="none" stroke="#818cf8" stroke-width="1.8" stroke-dasharray="3 2" points="${fc}"/><circle cx="${X(ni)}" cy="${Y(now)}" r="3" fill="#fff"/></svg><span class="fl-v"><b>${fmt(now)}</b> now<small class="${trend}">${trend} to ${fmt(end)} in ${p.q.length - 1 - ni} d</small></span></div>`;
    }).join('');
  });
}

function drawChart(wrap, d, expose) {
  const h = d.wx.hourly, n = h.time.length, epoch = i => Date.parse(h.time[i] + ':00+07:00') / 1000;
  const nowI = Math.max(0, h.time.findIndex(t => t >= d.wx.current.time.slice(0, 13)));
  const render = () => {
    const W = Math.max(320, wrap.clientWidth), H = 128, L = 34, R = 32, T = 22, B = 40, pw = W - L - R, ph = H - T - B, bw = pw / n;
    const maxR = Math.max(2, Math.ceil(Math.max(...h.precipitation))), y = v => T + ph - (v / maxR) * ph, x = i => L + i * bw;
    const grid = [0, maxR / 2, maxR].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#2a3644" stroke-width="1"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end" fill="#8b98a5" font-size="10">${+v.toFixed(1)}</text>`).join('');
    const bars = h.precipitation.map((v, i) => `<rect x="${x(i) + .5}" y="${y(v)}" width="${Math.max(1, bw - 1)}" height="${Math.max(0, ph - (y(v) - T))}" rx="1" fill="${i < nowI ? '#3f7ea3' : '#38bdf8'}"><title>${h.time[i].replace('T', ' ')} · ${v} mm/h · ${h.precipitation_probability[i]}%</title></rect>`).join('');
    const line = `<polyline fill="none" stroke="#facc15" stroke-width="1.4" stroke-linejoin="round" points="${h.precipitation_probability.map((p, i) => `${x(i) + bw / 2},${T + ph - (p / 100) * ph}`).join(' ')}"/>`;
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], dow = t => DOW[new Date(`${t.slice(0, 10)}T00:00:00Z`).getUTCDay()];
    const hourTicks = h.time.map((t, i) => ({ t, i })).filter(({ t }) => +t.slice(11, 13) % 6 === 0).map(({ t, i }) => {
      const mid = t.slice(11, 13) === '00';
      return `<line x1="${x(i) + bw / 2}" x2="${x(i) + bw / 2}" y1="${T + ph}" y2="${T + ph + 3}" stroke="#8b98a5"/><text x="${x(i) + bw / 2}" y="${T + ph + 14}" text-anchor="middle" fill="#8b98a5" font-size="10">${t.slice(11, 13)}h</text>`
        + (mid ? `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + ph + 34}" stroke="#4b5b6c" stroke-width="1"/>` : ''); }).join('');
    // second row: one day label per day, centred on the part of the day that is on the chart
    const days = []; h.time.forEach((t, i) => { const k = t.slice(0, 10); const last = days.at(-1); if (last && last.k === k) last.e = i; else days.push({ k, s:i, e:i, t }); });
    const dayRow = days.map(dd => { const x0 = x(dd.s), x1 = x(dd.e + 1), wide = x1 - x0 > 70;
      return `<text x="${(x0 + x1) / 2}" y="${T + ph + 30}" text-anchor="middle" fill="#e6edf3" font-size="11" font-weight="600">${x1 - x0 < 26 ? '' : wide ? `${dow(dd.t)} ${dd.k.slice(8, 10)}/${dd.k.slice(5, 7)}` : dow(dd.t)}</text>`; }).join('');
    const ticks = hourTicks + dayRow;
    const nx = x(nowI), now = `<line x1="${nx}" x2="${nx}" y1="${T - 2}" y2="${T + ph}" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 3"/><rect x="${nx - 17}" y="${T - 17}" width="34" height="15" rx="7.5" fill="#fff"/><text x="${nx}" y="${T - 6}" text-anchor="middle" fill="#0b0f14" font-size="10.5" font-weight="800" letter-spacing=".05em">NOW</text>`;
    const pct = [0, 50, 100].map(v => `<text x="${W - R + 4}" y="${T + ph - (v / 100) * ph + 3}" fill="#facc15" font-size="10">${v}%</text>`).join('')
      + `<text x="${W - 2}" y="8" text-anchor="end" fill="#facc15" font-size="10">chance</text><text x="2" y="8" fill="#38bdf8" font-size="10">mm/h</text>`;
    wrap.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Hourly rain forecast">${grid}${bars}${line}${ticks}${now}${pct}<line id="scrub" x1="0" x2="0" y1="${T - 4}" y2="${T + ph}" stroke="#7dd3fc" stroke-width="2" opacity="0"/></svg>${d.wx.unavailable ? '<div class="dim">Forecast unavailable</div>' : d.wx.stale ? '<div class="dim">Cached forecast: the live source did not answer.</div>' : ''}`;
    const sc = wrap.querySelector('#scrub');
    expose(ts => { const hi = (ts - epoch(0)) / 3600; const xx = x(0) + hi * bw + bw / 2; sc.setAttribute('x1', xx); sc.setAttribute('x2', xx); sc.setAttribute('opacity', hi >= 0 && hi <= n ? 1 : 0); });
  };
  render();
  let last = wrap.clientWidth; new ResizeObserver(() => { if (Math.abs(wrap.clientWidth - last) > 8) { last = wrap.clientWidth; render(); } }).observe(wrap);
}
