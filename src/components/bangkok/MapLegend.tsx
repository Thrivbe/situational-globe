'use client';

import { useMemo } from 'react';
import { CITY_PACK_LEGEND } from './city3d';
import { LAYERS, type LayerKey, type LegendItem } from './layers';
import { translate as tr } from './copy';
import type { BangkokView, Language } from './types';

export default function MapLegend({ active, language, view, city3d }: {
  active: Record<LayerKey, boolean>;
  language: Language;
  view: BangkokView;
  city3d: boolean;
}) {
  const layers = useMemo(() => LAYERS.filter((layer) => active[layer.key] &&
    (view === '2d' ? layer.ids2d.length : layer.ids3d.length)), [active, view]);
  const items = (legend: LegendItem[]) => legend.map((item) => <span key={item.label}>
    <i className={`lg ${item.shape}`} style={{ background: item.color }} />{tr(language, `legend_${item.label}`, item.label, item.thai)}
  </span>);
  return (
    <details className="maplegend">
      <summary>{tr(language, 'legend', 'Legend')}</summary>
      <div className="legend">{layers.map((layer) => <div className="lrow" key={layer.key}>
        <span className="lt">{tr(language, `layer_${layer.key}`, layer.label, layer.thai)}</span>
        <span className="chips">{items(view === '3d' ? layer.legend3d ?? layer.legend2d : layer.legend2d)}</span>
      </div>)}{view === '3d' && city3d && <div className="lrow" key="city-pack">
        <span className="lt">{tr(language, 'cityPack', '3D city')}</span><span className="chips">{items(CITY_PACK_LEGEND)}</span>
      </div>}</div>
    </details>
  );
}
