'use client';

import { useMemo } from 'react';
import { LAYERS_2D, type LayerKey } from './layers';
import type { Language } from './types';

export default function MapLegend({ active, language }: { active: Record<LayerKey, boolean>; language: Language }) {
  const layers = useMemo(() => LAYERS_2D.filter((layer) => active[layer.key]), [active]);
  return (
    <details className="maplegend">
      <summary>{language === 'th' ? 'สัญลักษณ์' : 'Legend'}</summary>
      <div className="legend">{layers.map((layer) => <div className="lrow" key={layer.key}>
        <span className="lt">{language === 'th' ? layer.thai : layer.label}</span>
        <span className="chips">{layer.legend.map((item) => <span key={item.label}>
          <i className={`lg ${item.shape}`} style={{ background: item.color }} />{item.label}
        </span>)}</span>
      </div>)}</div>
    </details>
  );
}
