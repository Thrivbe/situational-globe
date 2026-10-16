import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = [
  new URL('.', import.meta.url),
  new URL('../../app/bangkok/', import.meta.url),
];

function files(url: URL): string[] {
  const directory = url.pathname;
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(new URL(`${entry.name}/`, url)) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('Bangkok browser network boundary', () => {
  it('does not contain direct browser feed URLs owned by the refresh Worker', () => {
    const source = roots.flatMap(files).map((file) => readFileSync(file, 'utf8')).join('\n');
    const fetchCalls = source.match(/fetch\s*\([\s\S]*?\)/gi)?.join('\n') ?? '';
    expect(fetchCalls).not.toMatch(/floodboard\.org\//i);
    expect(fetchCalls).not.toMatch(/open-meteo\.com/i);
    expect(fetchCalls).not.toMatch(/overpass/i);
  });
});
