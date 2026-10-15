import { describe, expect, it } from 'vitest';
import { findLocalMap } from './registry';

describe('situation registry', () => {
  it('finds Bangkok by its local-map id', () => {
    expect(findLocalMap('bangkok-flood')).toMatchObject({
      situation: { id: 'bangkok-flood-2026' },
      localMap: { id: 'bangkok-flood' },
    });
  });

  it('returns undefined for an unknown local-map id', () => {
    expect(findLocalMap('nope')).toBeUndefined();
  });
});
