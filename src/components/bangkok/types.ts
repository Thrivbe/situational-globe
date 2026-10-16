import type { Bounds } from './helpers';

export type Language = 'en' | 'th';
export type RadarStatus = 'loading' | 'ready' | 'unavailable';

export type BangkokMapApi = {
  fitBounds(bounds: Bounds, maxZoom?: number): void;
  flyTo(longitude: number, latitude: number, zoom?: number): void;
  showUserLocation(longitude: number, latitude: number): void;
};
