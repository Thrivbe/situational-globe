'use client';

import type { Snapshot } from '@/situations/types';
import { translate as tr } from './copy';
import type { Language } from './types';

export default function MapCredit({ snapshot, language }: { snapshot: Snapshot; language: Language }) {
  const credits = snapshot.credits.filter((credit) => /^https?:\/\//i.test(credit.url));
  if (!credits.length) return null;
  return (
    <details className="mapcredit" aria-label={tr(language, 'mapCredits', 'Map data credits')}>
      <summary>© {tr(language, 'sources', 'Sources')}</summary>
      <div className="mapcredit-body">{credits.map((credit, index) => (
        <span key={`${credit.feed}-${index}`}>
          {index > 0 ? ' · ' : ''}<a href={credit.url} target="_blank" rel="noreferrer">{credit.text}</a> ({credit.licence}{credit.note ? `, ${credit.note}` : ''})
        </span>
      ))}</div>
    </details>
  );
}
