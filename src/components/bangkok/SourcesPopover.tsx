'use client';

import { useEffect, useRef } from 'react';
import type { Snapshot } from '@/situations/types';
import { translate as tr } from './copy';
import type { Language } from './types';

export default function SourcesPopover({ snapshot, language, onClose }: {
  snapshot: Snapshot;
  language: Language;
  onClose(): void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const credits = snapshot.credits.filter((credit) => /^https?:\/\//i.test(credit.url));

  useEffect(() => headingRef.current?.focus(), []);

  return (
    <div id="sources" className="sources" role="dialog" aria-labelledby="sources-heading">
      <h2 id="sources-heading" ref={headingRef} tabIndex={-1}>
        <span>{tr(language, 'sourceTitle', 'Sources and licences')}</span>
        <button type="button" className="lnk" onClick={onClose}>{tr(language, 'close', 'Close')}</button>
      </h2>
      <ul>
        {credits.map((credit, index) => (
          <li key={`${credit.feed}-${index}`}>
            <b><a href={credit.url} target="_blank" rel="noreferrer">{credit.text}</a></b>
            <span>{credit.feed} · {credit.licence}{credit.note ? <> · <em>{credit.note}</em></> : null}</span>
          </li>
        ))}
      </ul>
      <p className="warn">{language === 'th'
        ? 'นี่ไม่ใช่คำเตือนอย่างเป็นทางการ ข้อมูลอาจไม่ครบหรือล่าช้า'
        : 'This is not an official warning. Data may be incomplete or late.'}</p>
    </div>
  );
}
