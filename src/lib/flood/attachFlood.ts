import type * as maplibregl from 'maplibre-gl';
import { getFloodFetches, loadFloodData, type FloodData } from './data';
import { BKK_BOX, SHORT_CREDIT } from './feeds';
import { addFlood2DLayers, type FloodLayerRegistrar } from './layers2d';
import { addFlood3DLayers } from './layers3d';

export type FloodMode = '2d' | '3d';
export type FloodAnimationRate = 'raf' | '10hz' | 'off';

export type FloodStats = {
  mode: FloodMode;
  layers: number;
  sources: number;
  animRunning: boolean;
  paintUpdates: number;
  fetches: Record<string, 'ok' | 'failed' | 'pending'>;
  overpassCalls: number;
};

export type FloodHandle = {
  setMode(mode: FloodMode): void;
  destroy(): void;
  stats(): FloodStats;
};

declare global {
  interface Window {
    __floodAnim?: FloodAnimationRate;
  }
}

const CREDIT_SOURCE = 'flood-credit';
const CREDIT_LAYER = 'flood-credit';
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

export function attachFlood(map: maplibregl.Map, opts: { mode: FloodMode }): FloodHandle {
  let mode = opts.mode;
  let data: FloodData | null = null;
  let destroyed = false;
  let animationFrame: number | null = null;
  let animationRunning = false;
  let paintUpdates = 0;
  let lastPaintAt = 0;
  const animationStartedAt = performance.now();
  const modeLayers = new Set<string>();
  const modeSources = new Set<string>();
  const commonLayers = new Set<string>();
  const commonSources = new Set<string>();

  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && window.__floodAnim === undefined) {
    window.__floodAnim = '10hz';
  }

  const mapUsable = () => {
    if (destroyed) return false;
    try { return Boolean(map.getStyle()); } catch { return false; }
  };

  const beforeId = () => {
    try { return map.getLayer('day-night-fill') ? 'day-night-fill' : undefined; } catch { return undefined; }
  };

  const removeLayer = (id: string) => {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* map may already be removed */ }
  };
  const removeSource = (id: string) => {
    try { if (map.getSource(id)) map.removeSource(id); } catch { /* map may already be removed */ }
  };

  const registrarFor = (layers: Set<string>, sources: Set<string>): FloodLayerRegistrar => ({
    addSource(id, source) {
      if (!mapUsable()) return;
      if (!map.getSource(id)) {
        map.addSource(id, source);
        sources.add(id);
      }
    },
    addLayer(layer) {
      if (!mapUsable()) return;
      if (!map.getLayer(layer.id)) {
        map.addLayer(layer, beforeId());
        layers.add(layer.id);
      }
    },
  });

  const stopAnimation = () => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    animationRunning = false;
  };

  const animationRate = (): FloodAnimationRate => {
    const value = typeof window !== 'undefined' ? window.__floodAnim : undefined;
    return value === 'raf' || value === 'off' ? value : '10hz';
  };

  const bangkokInView = () => {
    try {
      const bounds = map.getBounds();
      return bounds.getEast() >= BKK_BOX[0]
        && bounds.getWest() <= BKK_BOX[2]
        && bounds.getNorth() >= BKK_BOX[1]
        && bounds.getSouth() <= BKK_BOX[3];
    } catch { return false; }
  };

  const shouldAnimate = () => {
    if (destroyed || mode !== '3d' || animationRate() === 'off') return false;
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
    try {
      return map.getZoom() >= 12 && Boolean(map.getLayer('flood-reports-glow')) && bangkokInView();
    } catch { return false; }
  };

  const animate = (now: number) => {
    animationFrame = null;
    if (!shouldAnimate()) { animationRunning = false; return; }
    const rate = animationRate();
    if (rate === 'raf' || now - lastPaintAt >= 100) {
      const phase = ((now - animationStartedAt) % 1600) / 1600;
      try {
        map.setPaintProperty('flood-reports-glow', 'circle-opacity', 0.55 * (1 - phase));
        paintUpdates++;
        lastPaintAt = now;
      } catch {
        animationRunning = false;
        return;
      }
    }
    animationFrame = requestAnimationFrame(animate);
  };

  const updateAnimationGate = () => {
    if (!shouldAnimate()) { stopAnimation(); return; }
    if (animationRunning) return;
    animationRunning = true;
    animationFrame = requestAnimationFrame(animate);
  };

  const removeMode = () => {
    stopAnimation();
    [...modeLayers].reverse().forEach(removeLayer);
    [...modeSources].reverse().forEach(removeSource);
    modeLayers.clear();
    modeSources.clear();
  };

  const addMode = () => {
    if (!data || !mapUsable()) return;
    removeMode();
    try {
      const registrar = registrarFor(modeLayers, modeSources);
      if (mode === '2d') addFlood2DLayers(registrar, data);
      else addFlood3DLayers(registrar, data);
    } catch (error) {
      console.warn('[flood] Could not add flood layers:', error);
      removeMode();
    }
    updateAnimationGate();
  };

  const commonRegistrar = registrarFor(commonLayers, commonSources);
  commonRegistrar.addSource(CREDIT_SOURCE, { type: 'geojson', data: EMPTY, attribution: SHORT_CREDIT });
  commonRegistrar.addLayer({
    id: CREDIT_LAYER,
    type: 'circle',
    source: CREDIT_SOURCE,
    paint: { 'circle-radius': 0, 'circle-opacity': 0 },
  });

  const onMoveEnd = () => updateAnimationGate();
  const onZoomEnd = () => updateAnimationGate();
  const onVisibilityChange = () => updateAnimationGate();
  map.on('moveend', onMoveEnd);
  map.on('zoomend', onZoomEnd);
  document.addEventListener('visibilitychange', onVisibilityChange);

  loadFloodData().then(loaded => {
    if (destroyed) return;
    data = loaded;
    addMode();
  });

  return {
    setMode(nextMode) {
      if (destroyed || nextMode === mode) { updateAnimationGate(); return; }
      mode = nextMode;
      addMode();
    },
    destroy() {
      if (destroyed) return;
      stopAnimation();
      try { map.off('moveend', onMoveEnd); } catch { /* map may already be removed */ }
      try { map.off('zoomend', onZoomEnd); } catch { /* map may already be removed */ }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      removeMode();
      [...commonLayers].reverse().forEach(removeLayer);
      [...commonSources].reverse().forEach(removeSource);
      commonLayers.clear();
      commonSources.clear();
      destroyed = true;
    },
    stats() {
      return {
        mode,
        layers: modeLayers.size + commonLayers.size,
        sources: modeSources.size + commonSources.size,
        animRunning: animationRunning,
        paintUpdates,
        fetches: getFloodFetches(),
        overpassCalls: 0,
      };
    },
  };
}
