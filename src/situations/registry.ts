import bangkok from './bangkok-flood-2026/situation.json';
import type { LocalMap, Situation } from './types';
import { validateSituation } from './validate';

export const SITUATIONS: readonly Situation[] = [validateSituation(bangkok)];

export function findLocalMap(id: string): { situation: Situation; localMap: LocalMap } | undefined {
  for (const situation of SITUATIONS) {
    const localMap = situation.localMaps.find((candidate) => candidate.id === id);
    if (localMap) return { situation, localMap };
  }
  return undefined;
}
