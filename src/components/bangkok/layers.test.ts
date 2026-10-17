import { describe, expect, it } from 'vitest';
import { LAYERS, TWO_D_ONLY_KEYS } from './layers';

describe('Bangkok layer table', () => {
  it('assigns every row to a group', () => {
    expect(LAYERS.every((layer) => ['flood', 'help', 'city'].includes(layer.group))).toBe(true);
  });

  it('has exactly the specified 2D-only keys', () => {
    expect([...TWO_D_ONLY_KEYS].sort()).toEqual(['airports', 'fire', 'landmarks', 'raingrid', 'waterways']);
  });
});
