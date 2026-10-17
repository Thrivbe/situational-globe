import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCityAnimation, shouldTick, type TickState } from './animation';

const ready = (changes: Partial<TickState> = {}): TickState => ({
  enabled: true,
  view: '3d',
  documentHidden: false,
  cityInView: true,
  now: 200,
  lastTick: 100,
  ...changes,
});

describe('shouldTick', () => {
  it('ticks when every gate is open and 100 ms elapsed', () => {
    expect(shouldTick(ready())).toBe(true);
  });

  it('stops when disabled', () => {
    expect(shouldTick(ready({ enabled: false }))).toBe(false);
  });

  it('stops in 2D', () => {
    expect(shouldTick(ready({ view: '2d' }))).toBe(false);
  });

  it('stops while the document is hidden', () => {
    expect(shouldTick(ready({ documentHidden: true }))).toBe(false);
  });

  it('stops while the city is out of view', () => {
    expect(shouldTick(ready({ cityInView: false }))).toBe(false);
  });

  it('does not tick before 100 ms', () => {
    expect(shouldTick(ready({ now: 199 }))).toBe(false);
  });
});

class ListenerTarget {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(name: string, listener: () => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, listener: () => void) { this.listeners.get(name)?.delete(listener); }
  emit(name: string) { for (const listener of this.listeners.get(name) ?? []) listener(); }
}

class AnimationMap {
  canvas = new ListenerTarget();
  container = {};
  listeners = new Map<string, Set<() => void>>();
  paintWrites: [string, string, unknown][] = [];
  bearing = 0;
  layers = new Set(['c3-danger', 'c3-report-glow', 'c3-buildings']);
  getLayer(id: string) { return this.layers.has(id) ? { id } : undefined; }
  getLayoutProperty() { return 'visible'; }
  setPaintProperty(id: string, property: string, value: unknown) { this.paintWrites.push([id, property, value]); }
  getBounds() { return { getWest: () => 100.4, getSouth: () => 13.6, getEast: () => 100.8, getNorth: () => 14.01 }; }
  getCanvas() { return this.canvas; }
  getContainer() { return this.container; }
  isMoving() { return false; }
  getBearing() { return this.bearing; }
  setBearing(value: number) { this.bearing = value; }
  stop() { return this as unknown as MapLibreMap; }
  on(name: string, listener: () => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    return this as unknown as MapLibreMap;
  }
  off(name: string, listener: () => void) {
    this.listeners.get(name)?.delete(listener);
    return this as unknown as MapLibreMap;
  }
  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | null = null;
  disconnected = false;
  target: unknown;
  constructor(private readonly callback: IntersectionObserverCallback) { FakeIntersectionObserver.latest = this; }
  observe(target: unknown) { this.target = target; }
  disconnect() { this.disconnected = true; }
  show(isIntersecting: boolean) {
    this.callback([{ target: this.target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }] as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

function animationHarness() {
  const documentTarget = new ListenerTarget() as ListenerTarget & { hidden: boolean };
  documentTarget.hidden = false;
  const callbacks = new Map<number, FrameRequestCallback>();
  let frames = 0;
  const cancelled: number[] = [];
  vi.stubGlobal('document', documentTarget);
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames += 1;
    callbacks.set(frames, callback);
    return frames;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { cancelled.push(id); callbacks.delete(id); });
  const map = new AnimationMap();
  const animation = createCityAnimation(map.asMap());
  FakeIntersectionObserver.latest?.show(true);
  return { animation, callbacks, cancelled, documentTarget, frameCount: () => frames, map };
}

afterEach(() => {
  FakeIntersectionObserver.latest = null;
  vi.unstubAllGlobals();
});

describe('city animation lifecycle', () => {
  it('schedules no frames when disabled or in 2D', () => {
    const harness = animationHarness();
    harness.animation.update({ enabled: false, view: '3d', city3d: true });
    harness.animation.update({ enabled: true, view: '2d', city3d: true });
    expect(harness.frameCount()).toBe(0);
    harness.animation.destroy();
  });

  it('stops for a hidden document and removes listeners on destroy', () => {
    const harness = animationHarness();
    harness.animation.update({ enabled: true, view: '3d', city3d: true });
    expect(harness.frameCount()).toBe(1);

    harness.documentTarget.hidden = true;
    harness.documentTarget.emit('visibilitychange');
    expect(harness.cancelled).toEqual([1]);
    harness.animation.update({ enabled: true, view: '3d', city3d: true });
    expect(harness.frameCount()).toBe(1);

    const observer = FakeIntersectionObserver.latest;
    harness.animation.destroy();
    expect(harness.documentTarget.listeners.get('visibilitychange')?.size ?? 0).toBe(0);
    expect(harness.map.listeners.get('moveend')?.size ?? 0).toBe(0);
    expect([...harness.map.canvas.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    expect(observer?.disconnected).toBe(true);
  });
});
