import { describe, expect, it } from 'vitest';
import { shouldTick, type TickState } from './animation';

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
