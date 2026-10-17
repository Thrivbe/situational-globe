import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { BANGKOK_BBOX } from '@/situations/bangkok-flood-2026/derive';
import {
  BUILDING_HEIGHT,
  STATIC_DANGER_OPACITY,
  STATIC_REPORT_GLOW_OPACITY,
  STATIC_REPORT_GLOW_RADIUS,
  buildingHeightAt,
} from './city3d';
import type { BangkokView } from './types';

export type TickState = {
  enabled: boolean;
  view: BangkokView;
  documentHidden: boolean;
  cityInView: boolean;
  now: number;
  lastTick: number;
};

export function shouldTick(state: TickState): boolean {
  return state.enabled && state.view === '3d' && !state.documentHidden && state.cityInView &&
    state.now - state.lastTick >= 100;
}

type LiveState = { enabled: boolean; view: BangkokView; city3d: boolean };
export type CityAnimation = { update(next: LiveState): void; destroy(): void };

const interpolate = (...stops: unknown[]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops] as ExpressionSpecification;
const buildingBase = (height: ExpressionSpecification): ExpressionSpecification =>
  ['min', ['coalesce', ['get', 'render_min_height'], 0], height] as ExpressionSpecification;

function intersectsBangkok(map: MapLibreMap): boolean {
  const bounds = map.getBounds();
  return bounds.getEast() >= BANGKOK_BBOX[0] && bounds.getWest() <= BANGKOK_BBOX[2] &&
    bounds.getNorth() >= BANGKOK_BBOX[1] && bounds.getSouth() <= BANGKOK_BBOX[3];
}

export function createCityAnimation(map: MapLibreMap): CityAnimation {
  let live: LiveState = { enabled: false, view: '2d', city3d: true };
  let frameId: number | null = null;
  let lastFrame = 0;
  let lastTick = -Infinity;
  let pauseOrbitUntil = 0;
  let riseStarted = 0;
  let rising = false;
  let destroyed = false;
  let containerInView = typeof IntersectionObserver === 'undefined';

  const setPaint = (id: string, property: string, value: unknown) => {
    if (map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none') {
      map.setPaintProperty(id, property as never, value as never);
    }
  };
  const setBuildingHeight = (scale: number) => {
    const height = scale >= 1 ? BUILDING_HEIGHT : buildingHeightAt(scale);
    setPaint('c3-buildings', 'fill-extrusion-height', height);
    setPaint('c3-buildings', 'fill-extrusion-base', buildingBase(height));
  };
  const staticPaint = () => {
    setPaint('c3-danger', 'fill-opacity', STATIC_DANGER_OPACITY);
    setPaint('c3-report-glow', 'circle-radius', STATIC_REPORT_GLOW_RADIUS);
    setPaint('c3-report-glow', 'circle-opacity', STATIC_REPORT_GLOW_OPACITY);
    setBuildingHeight(1);
    rising = false;
  };
  const cityInView = () => containerInView && intersectsBangkok(map);
  const running = () => live.enabled && live.view === '3d' && !document.hidden && cityInView();

  const paintFrame = (now: number) => {
    const seconds = now / 1_000;
    const pulse = 0.5 + 0.5 * Math.sin(seconds * 2.1);
    const ring = (seconds % 1.6) / 1.6;
    setPaint('c3-danger', 'fill-opacity', interpolate(11, 0.2 + 0.06 * pulse, 14, 0.12 + 0.05 * pulse, 16, 0.06));
    setPaint('c3-report-glow', 'circle-radius', interpolate(12, 4 + 6 * ring, 14, 10 + 22 * ring, 17, 36 + 60 * ring));
    setPaint('c3-report-glow', 'circle-opacity', STATIC_REPORT_GLOW_OPACITY * (1 - ring));
    if (rising) {
      const elapsed = Math.max(0, Math.min(1, (now - riseStarted) / 1_200));
      const scale = Math.max(0, Math.min(1, 1 - (1 - elapsed) ** 3));
      setBuildingHeight(scale);
      if (elapsed >= 1) rising = false;
    }
  };

  const schedule = () => {
    if (destroyed || frameId !== null || !running()) return;
    frameId = requestAnimationFrame(loop);
  };
  const cancel = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    lastFrame = 0;
  };
  const loop = (now: number) => {
    frameId = null;
    if (!running()) {
      lastFrame = 0;
      return;
    }
    if (shouldTick({ enabled: live.enabled, view: live.view, documentHidden: document.hidden,
      cityInView: cityInView(), now, lastTick })) {
      paintFrame(now);
      lastTick = now;
    }
    if (lastFrame && now >= pauseOrbitUntil && !map.isMoving()) {
      map.setBearing(map.getBearing() + 1.5 * Math.min(now - lastFrame, 100) / 1_000);
    }
    lastFrame = now;
    schedule();
  };
  const visibility = () => {
    if (document.hidden) cancel();
    else schedule();
  };
  const moved = () => schedule();
  const pauseOrbit = () => {
    pauseOrbitUntil = performance.now() + 10_000;
    map.stop();
  };
  const canvas = map.getCanvas();
  const interactions = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;
  for (const event of interactions) canvas.addEventListener(event, pauseOrbit, { passive: true });
  document.addEventListener('visibilitychange', visibility);
  map.on('moveend', moved);
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    const entry = entries.find((candidate) => candidate.target === map.getContainer()) ?? entries[0];
    containerInView = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0);
    if (containerInView) schedule();
    else cancel();
  });
  observer?.observe(map.getContainer());

  return {
    update(next) {
      const entering = live.view !== '3d' && next.view === '3d';
      live = next;
      if (entering && next.enabled && next.city3d) {
        if (running()) {
          riseStarted = performance.now();
          rising = true;
          setBuildingHeight(0);
        } else {
          rising = false;
          setBuildingHeight(1);
        }
      } else if (!next.enabled || next.view !== '3d' || !next.city3d) {
        staticPaint();
      }
      if (next.enabled && next.view === '3d' && !document.hidden) schedule();
      else cancel();
    },
    destroy() {
      destroyed = true;
      cancel();
      document.removeEventListener('visibilitychange', visibility);
      map.off('moveend', moved);
      observer?.disconnect();
      for (const event of interactions) canvas.removeEventListener(event, pauseOrbit);
    },
  };
}
