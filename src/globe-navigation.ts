/**
 * Camera framing adapted from God's Eye View src/search/coordinateGeocoder.js,
 * Bilawal Sidhu (MIT), commit e7707d9a0f34d9fbffc300023c319f95caa5be30.
 * Adaptation: exported validation and camera-only bounds; no remote geocoder.
 * The complete upstream license is in vendor/gods-eye/LICENSE.
 */
export function coordinateFrame(lat: number, lon: number, halfSpan = 0.015) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(halfSpan) || halfSpan <= 0 || halfSpan > 90) return null;
  const wrap = (value: number) => {
    const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 ? 180 : wrapped;
  };
  return { west: wrap(lon - halfSpan), south: Math.max(-90, lat - halfSpan), east: wrap(lon + halfSpan), north: Math.min(90, lat + halfSpan) };
}
