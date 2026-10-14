import * as THREE from 'three';
import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.7.0/dist/maplibre-gl.mjs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const THREE_IDS = { 'bloom-real':'fx-bloom-real', 'shadows-real':'fx-shadows-real', 'water-shader':'fx-water-shader' };
const HOT_ROADS = d => d.roads.features.filter(f => f.properties.sev >= 3);

function linesOf(geometry) {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  return geometry.type === 'MultiLineString' ? geometry.coordinates : [];
}

function projection(camera, args, origin) {
  const raw = args?.defaultProjectionData?.mainMatrix || args;
  const transform = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(origin.scale, origin.scale, origin.scale)); // geometry is already mercator-y (south-positive); a -y here mirrored it
  camera.projectionMatrix.fromArray(raw).multiply(transform);
}

function disposeObject(object) {
  object?.traverse?.(node => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(material => material.dispose());
    else node.material?.dispose?.();
  });
}

function makeBloomRibbon(d, origin, severity) {
  const positions = [], indices = [];
  for (const feature of HOT_ROADS(d).filter(item => item.properties.sev === severity)) for (const line of linesOf(feature.geometry)) {
    for (let i = 1; i < line.length; i++) {
      const a = maplibregl.MercatorCoordinate.fromLngLat(line[i - 1]), b = maplibregl.MercatorCoordinate.fromLngLat(line[i]);
      const ax = (a.x - origin.x) / origin.scale, ay = (a.y - origin.y) / origin.scale;
      const bx = (b.x - origin.x) / origin.scale, by = (b.y - origin.y) / origin.scale;
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy); if (length < .2) continue;
      const half = severity === 4 ? 10 : 7, nx = -dy / length * half, ny = dx / length * half, base = positions.length / 3;
      positions.push(ax + nx, ay + ny, 3, ax - nx, ay - ny, 3, bx + nx, by + ny, 3, bx - nx, by - ny, 3);
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function makeBloomLayer(map, d, rendererFor, hooks, origin) {
  let renderer, camera, roadScene, screenScene, screenCamera, rtA, rtB, blurMaterial, compositeMaterial;
  let width = 0, height = 0;
  const render = (scene, cam, target, clear = false) => {
    renderer.resetState();
    renderer.setRenderTarget(target);
    if (!target) renderer.setViewport(0, 0, renderer.getContext().drawingBufferWidth, renderer.getContext().drawingBufferHeight);
    if (clear) { renderer.setClearColor(0x000000, 0); renderer.clear(true, true, true); }
    renderer.render(scene, cam);
  };
  const sizeTargets = gl => {
    const w = Math.max(1, Math.floor(gl.drawingBufferWidth / 4)), h = Math.max(1, Math.floor(gl.drawingBufferHeight / 4));
    if (w === width && h === height) return;
    width = w; height = h; rtA?.dispose(); rtB?.dispose();
    rtA = new THREE.WebGLRenderTarget(w, h, { depthBuffer:false, stencilBuffer:false });
    rtB = new THREE.WebGLRenderTarget(w, h, { depthBuffer:false, stencilBuffer:false });
    blurMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
  };
  return {
    id:THREE_IDS['bloom-real'], type:'custom', renderingMode:'3d',
    onAdd(_map, gl) {
      renderer = rendererFor(gl); camera = new THREE.Camera(); roadScene = new THREE.Scene();
      for (const severity of [3, 4]) {
        const color = severity === 4 ? '#ff244f' : '#ff922e';
        roadScene.add(new THREE.Mesh(makeBloomRibbon(d, origin, severity), new THREE.MeshStandardMaterial({ color:0x000000, emissive:color,
          emissiveIntensity:5, transparent:true, opacity:.95, blending:THREE.AdditiveBlending, depthTest:false, side:THREE.DoubleSide, toneMapped:false })));
      }
      screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); screenScene = new THREE.Scene();
      blurMaterial = new THREE.ShaderMaterial({ depthTest:false, depthWrite:false, uniforms:{ uTexture:{ value:null }, uTexel:{ value:new THREE.Vector2() }, uDirection:{ value:new THREE.Vector2(1, 0) } },
        vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader:'uniform sampler2D uTexture; uniform vec2 uTexel; uniform vec2 uDirection; varying vec2 vUv; void main(){vec2 d=uTexel*uDirection;vec4 c=texture2D(uTexture,vUv)*.227027;c+=texture2D(uTexture,vUv+d*1.384615)*.316216;c+=texture2D(uTexture,vUv-d*1.384615)*.316216;c+=texture2D(uTexture,vUv+d*3.230769)*.070270;c+=texture2D(uTexture,vUv-d*3.230769)*.070270;gl_FragColor=c;}' });
      compositeMaterial = new THREE.ShaderMaterial({ transparent:true, depthTest:false, depthWrite:false, blending:THREE.AdditiveBlending,
        uniforms:{ uTexture:{ value:null }, uStrength:{ value:1.5 } },
        vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader:'uniform sampler2D uTexture;uniform float uStrength;varying vec2 vUv;void main(){gl_FragColor=texture2D(uTexture,vUv)*uStrength;}' });
      screenScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial));
    },
    render(gl, args) {
      const started = performance.now(); sizeTargets(gl); projection(camera, args, origin);
      render(roadScene, camera, rtA, true);
      for (const spread of [1, 2.5]) { // two separable blur passes at quarter resolution: wide, soft halo
        blurMaterial.uniforms.uTexture.value = rtA.texture; blurMaterial.uniforms.uDirection.value.set(spread, 0); render(screenScene, screenCamera, rtB, true);
        blurMaterial.uniforms.uTexture.value = rtB.texture; blurMaterial.uniforms.uDirection.value.set(0, spread); render(screenScene, screenCamera, rtA, true);
      }
      screenScene.children[0].material = compositeMaterial; compositeMaterial.uniforms.uTexture.value = rtA.texture;
      render(screenScene, screenCamera, null, false); screenScene.children[0].material = blurMaterial;
      hooks.recordRenderMs(performance.now() - started);
    },
    onRemove() { disposeObject(roadScene); disposeObject(screenScene); blurMaterial?.dispose(); compositeMaterial?.dispose(); rtA?.dispose(); rtB?.dispose(); }
  };
}

function makeWaterGeometry(d, origin) {
  const positions = [], uvs = [], indices = []; let along = 0;
  for (const feature of HOT_ROADS(d)) for (const line of linesOf(feature.geometry)) for (let i = 1; i < line.length; i++) {
    const a = maplibregl.MercatorCoordinate.fromLngLat(line[i - 1]), b = maplibregl.MercatorCoordinate.fromLngLat(line[i]);
    const ax = (a.x - origin.x) / origin.scale, ay = (a.y - origin.y) / origin.scale;
    const bx = (b.x - origin.x) / origin.scale, by = (b.y - origin.y) / origin.scale;
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy); if (length < .2) continue;
    const nx = -dy / length * 15, ny = dx / length * 15, base = positions.length / 3;
    positions.push(ax + nx, ay + ny, 1.5, ax - nx, ay - ny, 1.5, bx + nx, by + ny, 1.5, bx - nx, by - ny, 1.5);
    uvs.push(along / 18, 0, along / 18, 1, (along + length) / 18, 0, (along + length) / 18, 1);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3); along += length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function makeWaterLayer(map, d, rendererFor, hooks, origin) {
  let renderer, camera, scene, material;
  return {
    id:THREE_IDS['water-shader'], type:'custom', renderingMode:'3d',
    onAdd(_map, gl) {
      renderer = rendererFor(gl); camera = new THREE.Camera(); scene = new THREE.Scene();
      material = new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
        uniforms:{ uTime:{ value:0 } },
        vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'uniform float uTime;varying vec2 vUv;void main(){float r=.5+.5*sin(vUv.x*5.-uTime*5.+sin(vUv.x*.7)*2.);float edge=pow(abs(vUv.y-.5)*2.,3.);vec3 deep=vec3(.01,.24,.62);vec3 shine=vec3(.2,.9,1.);vec3 c=mix(deep,shine,.24*r+.62*edge);float a=.13+.15*r+.3*edge;gl_FragColor=vec4(c,a);}' });
      scene.add(new THREE.Mesh(makeWaterGeometry(d, origin), material));
    },
    setTime(now) { if (material) material.uniforms.uTime.value = now / 1000; },
    render(_gl, args) {
      const started = performance.now(); projection(camera, args, origin); renderer.resetState(); renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, renderer.getContext().drawingBufferWidth, renderer.getContext().drawingBufferHeight); renderer.render(scene, camera);
      hooks.recordRenderMs(performance.now() - started);
    },
    onRemove() { disposeObject(scene); material?.dispose(); }
  };
}

function featurePolygons(feature) {
  if (feature.geometry?.type === 'Polygon') return [feature.geometry.coordinates];
  return feature.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
}

function firstPoint(feature) {
  let value = feature.geometry?.coordinates;
  while (Array.isArray(value?.[0])) value = value[0];
  return Array.isArray(value) && Number.isFinite(value[0]) ? value : null;
}

function buildingHeight(feature) {
  const tagged = Number(feature.properties?.render_height) || 0, id = Number(feature.id) || 0;
  return Math.min(tagged > 3 ? tagged : 8 + 3 * (id % 7), 130);
}

function shapeFromPolygon(polygon, origin) {
  const makePath = (ring, Path) => {
    const path = new Path();
    ring.forEach((point, index) => { const mc = maplibregl.MercatorCoordinate.fromLngLat(point); const x = (mc.x - origin.x) / origin.scale, y = (mc.y - origin.y) / origin.scale; index ? path.lineTo(x, y) : path.moveTo(x, y); });
    return path;
  };
  const shape = makePath(polygon[0], THREE.Shape);
  for (const hole of polygon.slice(1)) shape.holes.push(makePath(hole, THREE.Path));
  return shape;
}

function makeShadowLayer(map, rendererFor, hooks, origin) {
  let renderer, camera, scene, light, caster = null, ground = null, lastView = '', rebuilding = false;
  const casterMaterial = new THREE.MeshBasicMaterial({ color:0x000000, side:THREE.DoubleSide }); casterMaterial.colorWrite = /shadowdebug/.test(location.search); if (casterMaterial.colorWrite) casterMaterial.color.set(0xff00ff);
  const groundMaterial = new THREE.ShadowMaterial({ color:0x000008, opacity:.55, transparent:true, depthWrite:false, side:THREE.DoubleSide });
  const rebuild = () => {
    const center = map.getCenter(), signature = `${center.lng.toFixed(4)}:${center.lat.toFixed(4)}:${map.getZoom().toFixed(2)}:${map.getBearing().toFixed(1)}:${map.getPitch().toFixed(1)}`;
    if (signature === lastView || rebuilding || !map.getSource('openmaptiles')) return;
    rebuilding = true; const started = performance.now();
    try {
      const bounds = map.getBounds(), seen = new Set(), candidates = [];
      for (const feature of map.querySourceFeatures('openmaptiles', { sourceLayer:'building' })) {
        const point = firstPoint(feature); if (!point || !bounds.contains(point) || Math.hypot((point[0] - center.lng) * 108000, (point[1] - center.lat) * 111000) > 1300) continue;
        const key = feature.id ?? `${point[0].toFixed(6)}:${point[1].toFixed(6)}:${feature.properties?.render_height || 0}`;
        if (seen.has(key)) continue; seen.add(key);
        candidates.push({ feature, distance:(point[0] - center.lng) ** 2 + (point[1] - center.lat) ** 2 });
      }
      candidates.sort((a, b) => a.distance - b.distance); const geometries = [];
      outer: for (const { feature } of candidates) for (const polygon of featurePolygons(feature)) {
        if (geometries.length >= 4000) break outer;
        if (!polygon[0]?.length) continue;
        try { geometries.push(new THREE.ExtrudeGeometry(shapeFromPolygon(polygon, origin), { depth:buildingHeight(feature), bevelEnabled:false, steps:1 })); } catch { /* malformed tile polygon */ }
      }
      if (caster) { scene.remove(caster); caster.geometry.dispose(); }
      if (geometries.length) {
        const merged = mergeGeometries(geometries, false); geometries.forEach(geometry => geometry.dispose());
        caster = new THREE.Mesh(merged, casterMaterial); caster.castShadow = true; scene.add(caster);
      } else caster = null;

      const sw = maplibregl.MercatorCoordinate.fromLngLat([bounds.getWest(), bounds.getSouth()]);
      const ne = maplibregl.MercatorCoordinate.fromLngLat([bounds.getEast(), bounds.getNorth()]);
      const sc = maplibregl.MercatorCoordinate.fromLngLat(center);
      const cx = (sc.x - origin.x) / origin.scale, cy = (sc.y - origin.y) / origin.scale;
      // ponytail: shadows only within 1.2 km of the view centre; the whole tilted view (tens of km) made each shadow texel ~25 m and every shadow vanished
      const spanX = 2400, spanY = 2400; void sw; void ne;
      if (ground) { scene.remove(ground); ground.geometry.dispose(); }
      ground = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanY), groundMaterial); ground.position.set(cx, cy, .2); ground.receiveShadow = true; scene.add(ground);
      const extent = Math.max(spanX, spanY) * .65;
      light.position.set(cx - extent * .45, cy - extent * .7, extent); light.target.position.set(cx, cy, 0);
      Object.assign(light.shadow.camera, { left:-extent, right:extent, top:extent, bottom:-extent, near:1, far:extent * 4 });
      light.shadow.camera.updateProjectionMatrix(); light.shadow.needsUpdate = true; lastView = signature; map.triggerRepaint();
    } finally { rebuilding = false; hooks.recordShadowMs(performance.now() - started); }
  };
  return {
    id:THREE_IDS['shadows-real'], type:'custom', renderingMode:'3d',
    onAdd(_map, gl) {
      renderer = rendererFor(gl); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      camera = new THREE.Camera(); scene = new THREE.Scene(); light = new THREE.DirectionalLight(0xffffff, 2.2);
      light.castShadow = true; light.shadow.mapSize.set(2048, 2048); light.shadow.bias = -.00015; scene.add(light, light.target);
      map.on('idle', rebuild);
    },
    render(_gl, args) {
      const started = performance.now(); projection(camera, args, origin); renderer.resetState(); renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, renderer.getContext().drawingBufferWidth, renderer.getContext().drawingBufferHeight); renderer.render(scene, camera);
      hooks.recordRenderMs(performance.now() - started);
    },
    onRemove() { map.off('idle', rebuild); disposeObject(caster); ground?.geometry.dispose(); casterMaterial.dispose(); groundMaterial.dispose(); light?.dispose?.(); }
  };
}

export function createFx3D(map, d, hooks) {
  const at = map.getCenter(), mercator = maplibregl.MercatorCoordinate.fromLngLat(at, 0);
  const origin = { x:mercator.x, y:mercator.y, z:mercator.z, scale:mercator.meterInMercatorCoordinateUnits() };
  let renderer = null;
  const rendererFor = gl => {
    if (!renderer) { renderer = new THREE.WebGLRenderer({ canvas:map.getCanvas(), context:gl, antialias:true }); renderer.autoClear = false; }
    return renderer;
  };
  const active = new Map();
  const factory = {
    'bloom-real':() => makeBloomLayer(map, d, rendererFor, hooks, origin),
    'shadows-real':() => makeShadowLayer(map, rendererFor, hooks, origin),
    'water-shader':() => makeWaterLayer(map, d, rendererFor, hooks, origin),
  };
  const set = (key, on) => {
    const id = THREE_IDS[key]; if (!id) return;
    if (on && !map.getLayer(id)) { const layer = factory[key](); active.set(key, layer); map.addLayer(layer); }
    if (!on && map.getLayer(id)) { map.removeLayer(id); active.delete(key); if (key === 'shadows-real' && renderer) renderer.shadowMap.enabled = false; }
  };
  return {
    set,
    tick(now) { const water = active.get('water-shader'); water?.setTime(now); return Boolean(water); },
    destroy() { for (const key of [...active.keys()]) set(key, false); active.clear(); renderer?.resetState(); }
  };
}
