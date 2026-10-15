import type { FeatureCollection } from 'geojson';

export type Level = 0 | 1 | 2 | 3;

export type Bbox = [west: number, south: number, east: number, north: number];

export type LocalMap = {
  id: string;
  name: string;
  bbox: Bbox;
  feeds: string[];
  layers2d: string[];
  cityPack?: {
    buildings: string;
    minZoom: number;
  };
};

export type Situation = {
  id: string;
  title: string;
  story: string;
  hazard: string;
  status: 'live' | 'past';
  defaultGlobalLayers: string[];
  situationLayers: string[];
  fallbackLevel: Level | null;
  localMaps: LocalMap[];
};

export type Credit = {
  feed: string;
  text: string;
  url: string;
  licence: string;
  note?: string;
};

export type Snapshot = {
  localMap: string;
  situation: string;
  builtAt: string;
  feedsAt: Record<string, string>;
  level: Level;
  credits: Credit[];
  flood: {
    roads: FeatureCollection;
    reports: FeatureCollection;
    dangerHexes: FeatureCollection;
    depthPoints: FeatureCollection;
  };
  weather: {
    current: Record<string, unknown>;
    hourly: Record<string, unknown>;
    grid: Record<string, unknown>[];
    districtRain: Record<string, unknown>[];
    river: Record<string, unknown>[];
  };
  osm: {
    builtAt: string;
    hospitals: FeatureCollection;
    shelters: FeatureCollection;
    pumping: FeatureCollection;
    fireStations: FeatureCollection;
    districts: FeatureCollection;
    transit: FeatureCollection;
    landmarks: FeatureCollection;
  };
  stationWater: FeatureCollection;
};
