'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Snapshot } from '@/situations/types';
import { bangkokTime, numberValues, stringList, textValue } from './helpers';

export type RadarFrame = { time: number; tile: string };

function RainChart({ snapshot, frameTime }: { snapshot: Snapshot; frameTime?: number }) {
  const hourly = snapshot.weather.hourly;
  const time = stringList(hourly.time);
  const precipitation = numberValues(hourly.precipitation, time.length);
  const chance = numberValues(hourly.precipitation_probability, time.length);
  const now = textValue(snapshot.weather.current.time).slice(0, 13);
  const currentIndex = now ? time.findIndex((item) => item >= now) : -1;
  const width = 720;
  const height = 126;
  const left = 32;
  const right = 32;
  const top = 22;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const barWidth = time.length ? chartWidth / time.length : chartWidth;
  let maxRain = 2;
  for (const value of precipitation) maxRain = Math.max(maxRain, value);
  const y = (value: number) => top + chartHeight - value / maxRain * chartHeight;
  const frameIndex = frameTime ? time.findIndex((item) => Date.parse(`${item}:00+07:00`) / 1_000 >= frameTime) : -1;

  return (
    <div className="tl-chart">
      <div className="tl-head"><b>Rain at Bangkok centre</b><span className="dim">past 12 h, next 48 h · bars: mm/h · line: chance %</span></div>
      {time.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hourly rain forecast" preserveAspectRatio="none">
        {[0, maxRain / 2, maxRain].map((value) => <g key={value}>
          <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#2a3644" />
          <text x={left - 4} y={y(value) + 3} textAnchor="end" fill="#8b98a5" fontSize="10">{Number(value.toFixed(1))}</text>
        </g>)}
        {precipitation.map((value, index) => <rect key={`${time[index]}-${index}`} x={left + index * barWidth + 0.5} y={y(value)}
          width={Math.max(1, barWidth - 1)} height={Math.max(0, chartHeight - (y(value) - top))} rx="1"
          fill={index < currentIndex ? '#3f7ea3' : '#38bdf8'} />)}
        <polyline fill="none" stroke="#facc15" strokeWidth="1.4" strokeLinejoin="round"
          points={chance.map((value, index) => `${left + index * barWidth + barWidth / 2},${top + chartHeight - value / 100 * chartHeight}`).join(' ')} />
        {currentIndex >= 0 && <line x1={left + currentIndex * barWidth} x2={left + currentIndex * barWidth} y1={top - 2} y2={top + chartHeight}
          stroke="#fff" strokeWidth="1.5" strokeDasharray="3 3" />}
        {frameIndex >= 0 && <line x1={left + frameIndex * barWidth + barWidth / 2} x2={left + frameIndex * barWidth + barWidth / 2}
          y1={top - 4} y2={top + chartHeight} stroke="#7dd3fc" strokeWidth="2" />}
        {time.map((item, index) => item.slice(11, 13) === '00' ? <text key={item} x={left + index * barWidth}
          y={height - 7} textAnchor="middle" fill="#e6edf3" fontSize="10">{item.slice(5, 10)}</text> : null)}
      </svg> : <div className="chartempty dim">Hourly rain forecast unavailable</div>}
    </div>
  );
}

type Props = {
  frames: RadarFrame[];
  frameIndex: number;
  onFrame(index: number): void;
  snapshot: Snapshot;
};

export default function RadarTimeline({ frames, frameIndex, onFrame, snapshot }: Props) {
  const [playing, setPlaying] = useState(false);
  const current = frames[frameIndex];
  const latest = Math.max(0, frames.length - 1);
  const endpoints = useMemo(() => ({ first: frames[0], last: frames.at(-1) }), [frames]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      onFrame(frameIndex >= frames.length - 1 ? 0 : frameIndex + 1);
    }, 650);
    return () => window.clearInterval(timer);
  }, [frameIndex, frames.length, onFrame, playing]);

  return (
    <footer className="timeline">
      <div className="tl-radar">
        <div className="tl-head"><b>Rain radar</b><span className="tl-time">{current ? bangkokTime(current.time * 1_000) : 'unavailable'}</span></div>
        <div className="tl-track"><input type="range" min="0" max={Math.max(0, latest)} value={Math.min(frameIndex, latest)}
          disabled={!frames.length} aria-label="Radar time" aria-valuetext={current ? bangkokTime(current.time * 1_000) : 'Radar unavailable'}
          onChange={(event) => { setPlaying(false); onFrame(Number(event.target.value)); }} /></div>
        <div className="tl-ends dim"><span>{endpoints.first ? `${bangkokTime(endpoints.first.time * 1_000)} observed` : ''}</span><span>{endpoints.last ? `${bangkokTime(endpoints.last.time * 1_000)} observed` : ''}</span></div>
        <div className="tl-key dim"><span><i className="k obs" />observed</span><span className="tl-btns">
          <button type="button" disabled={frames.length < 2} onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause' : 'Play'}</button>
          <button type="button" disabled={!frames.length} onClick={() => { setPlaying(false); onFrame(latest); }}>Latest</button>
        </span></div>
        <div className="tl-int"><span className="dim">Intensity</span><span className="ramp"><em>light</em><em>moderate</em><em>heavy</em></span></div>
        <div className="tl-note">Coloured areas are rainfall, not standing water.</div>
      </div>
      <RainChart snapshot={snapshot} frameTime={current?.time} />
    </footer>
  );
}
