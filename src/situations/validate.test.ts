import { describe, expect, it } from 'vitest';
import bangkok from './bangkok-flood-2026/situation.json';
import { validateSituation } from './validate';

function copySituation(): Record<string, unknown> {
  return structuredClone(bangkok) as Record<string, unknown>;
}

function firstLocalMap(situation: Record<string, unknown>): Record<string, unknown> {
  return (situation.localMaps as Record<string, unknown>[])[0];
}

describe('validateSituation', () => {
  it('accepts the Bangkok situation settings', () => {
    expect(validateSituation(bangkok)).toEqual(bangkok);
  });

  it('uses the specific fallback error before the generic level error', () => {
    const situation = copySituation();
    situation.localMaps = [];
    situation.fallbackLevel = null;
    expect(() => validateSituation(situation)).toThrow(/must be a number when localMaps is empty/);
  });

  it('accepts a marker-free global-only situation with a fallback level', () => {
    const situation = copySituation();
    situation.localMaps = [];
    situation.fallbackLevel = 2;
    delete situation.marker;
    expect(validateSituation(situation)).toMatchObject({ fallbackLevel: 2, localMaps: [] });
  });

  it('rejects unknown keys at every supported object level', () => {
    const top = copySituation();
    top.unexpected = true;
    expect(() => validateSituation(top)).toThrow(/unexpected/);

    const local = copySituation();
    firstLocalMap(local).unexpected = true;
    expect(() => validateSituation(local)).toThrow(/localMaps\[0\]\.unexpected/);

    const packed = copySituation();
    (firstLocalMap(packed).cityPack as Record<string, unknown>).unexpected = true;
    expect(() => validateSituation(packed)).toThrow(/localMaps\[0\]\.cityPack\.unexpected/);
  });

  it('rejects duplicate local-map ids', () => {
    const situation = copySituation();
    const localMap = firstLocalMap(situation);
    situation.localMaps = [localMap, structuredClone(localMap)];
    expect(() => validateSituation(situation)).toThrow(/duplicate local-map id/);
  });

  it('rejects longitude outside the world bounds', () => {
    const situation = copySituation();
    firstLocalMap(situation).bbox = [100, 13.5, 200, 14.05];
    expect(() => validateSituation(situation)).toThrow(/localMaps\[0\]\.bbox/);
  });

  it('rejects reversed bbox bounds', () => {
    const situation = copySituation();
    firstLocalMap(situation).bbox = [101, 13.5, 100.95, 14.05];
    expect(() => validateSituation(situation)).toThrow(/localMaps\[0\]\.bbox/);
  });

  it.each(['id', 'title'])('rejects an empty %s', (key) => {
    const situation = copySituation();
    situation[key] = '';
    expect(() => validateSituation(situation)).toThrow(new RegExp(key));
  });

  it('rejects an empty local-map id', () => {
    const situation = copySituation();
    firstLocalMap(situation).id = '';
    expect(() => validateSituation(situation)).toThrow(/localMaps\[0\]\.id/);
  });

  it('rejects minZoom outside 0-22', () => {
    const situation = copySituation();
    const cityPack = firstLocalMap(situation).cityPack as Record<string, unknown>;
    cityPack.minZoom = 23;
    expect(() => validateSituation(situation)).toThrow(/localMaps\[0\]\.cityPack\.minZoom/);
  });

  it("rejects the non-status value 'archived'", () => {
    const situation = copySituation();
    situation.status = 'archived';
    expect(() => validateSituation(situation)).toThrow(/status/);
  });

  it('rejects non-array feeds', () => {
    const situation = copySituation();
    firstLocalMap(situation).feeds = 'floodboard';
    expect(() => validateSituation(situation)).toThrow(/localMaps\[0\]\.feeds/);
  });

  it('rejects a string cityPack minZoom', () => {
    const situation = copySituation();
    const cityPack = firstLocalMap(situation).cityPack as Record<string, unknown>;
    cityPack.minZoom = '14';
    expect(() => validateSituation(situation)).toThrow(/localMaps\[0\]\.cityPack\.minZoom/);
  });
});
