export const BKK = [100.53, 13.75] as const;
export const BKK_BOX = [100.3, 13.5, 100.95, 14.05] as const;

export const FEEDS = {
  floodRoads: {
    url: 'https://floodboard.org/api/export/roads.geojson',
    licence: 'CC BY 4.0',
  },
  floodReports: {
    url: 'https://floodboard.org/api/export/reports.csv',
    licence: 'CC BY 4.0',
  },
  radar: {
    url: 'https://api.rainviewer.com/public/weather-maps.json',
    licence: 'RainViewer free API, attribution',
  },
  forecast: {
    url: `https://api.open-meteo.com/v1/forecast?latitude=${BKK[1]}&longitude=${BKK[0]}&current=precipitation,rain,temperature_2m,relative_humidity_2m,wind_speed_10m,uv_index&hourly=precipitation,precipitation_probability&past_hours=12&forecast_hours=48&timezone=Asia/Bangkok`,
    licence: 'CC BY 4.0, free tier non-commercial',
  },
  districts: { url: '/flood/osm-snapshot/districts.json', licence: 'ODbL (OpenStreetMap contributors)' },
  hospitals: { url: '/flood/osm-snapshot/hospitals.json', licence: 'ODbL (OpenStreetMap contributors)' },
  shelters: { url: '/flood/osm-snapshot/shelters.json', licence: 'ODbL (OpenStreetMap contributors)' },
  pumping: { url: '/flood/osm-snapshot/pumping.json', licence: 'ODbL (OpenStreetMap contributors)' },
  transit: { url: '/flood/osm-snapshot/transit.json', licence: 'ODbL (OpenStreetMap contributors)' },
  vectorTiles: {
    url: 'https://tiles.openfreemap.org/planet',
    licence: 'MIT (software), ODbL (data)',
  },
} as const;

export const CREDIT = 'Flood roads/reports © <a href="https://floodboard.org">Floodboard</a> (CC BY 4.0, may be incomplete) · '
  + '<a href="https://open-meteo.com/">Weather and river discharge data by Open-Meteo.com</a> (CC BY 4.0) · Radar © <a href="https://www.rainviewer.com">RainViewer</a> · '
  + 'Hospitals, shelters, pumps, landmarks, piers, car parks, metro lines, districts © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL) · '
  + 'Water level sensors: <a href="https://www.thaiwater.net">ThaiWater / HAII</a> (unconfirmed licence, prototype only)';

export const SHORT_CREDIT = '<a href="https://floodboard.org">Floodboard</a> CC BY 4.0 · <a href="https://open-meteo.com/">Open-Meteo</a> CC BY 4.0 · <a href="https://www.rainviewer.com">RainViewer</a> · '
  + '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors (ODbL)</a> · <a href="https://www.thaiwater.net">ThaiWater/HAII</a> (licence unconfirmed, prototype)';
