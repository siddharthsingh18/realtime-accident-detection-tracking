/**
 * Map Tile & GIS Configuration
 *
 * NOTE: The default tile server uses CartoDB Dark Matter / OpenStreetMap tiles for development.
 * Public OpenStreetMap and Carto tile servers have strict usage policies and rate limits.
 * Production deployments should host their own tile proxy/server or configure VITE_MAP_TILE_URL.
 */

export const MAP_CONFIG = {
  tileUrl:
    import.meta.env.VITE_MAP_TILE_URL ||
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  fallbackTileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
  defaultCenter: [28.6139, 77.209] as [number, number],
  defaultZoom: 14,
  minZoom: 3,
  maxZoom: 19,
};
