'use client';

import type { Snapshot } from '@/situations/types';

export default function MapCredit({ snapshot }: { snapshot: Snapshot }) {
  const credits = snapshot.credits.filter((credit) => /^https?:\/\//i.test(credit.url));
  if (!credits.length) return null;
  return (
    <div className="mapcredit" aria-label="Map data credits">
      {credits.map((credit, index) => (
        <span key={`${credit.feed}-${index}`}>
          {index > 0 ? ' · ' : ''}<a href={credit.url} target="_blank" rel="noreferrer">{credit.text}</a> ({credit.licence}{credit.note ? `, ${credit.note}` : ''})
        </span>
      ))}
    </div>
  );
}
