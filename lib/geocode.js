// Free geocoding via OpenStreetMap Nominatim.
// Usage rules: a proper User-Agent, max 1 request/second (enforced below).

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'lead-pitcher/1.0 (free B2B lead tool; contact: local user)';

let lastCall = 0;

async function politeWait() {
  const now = Date.now();
  const wait = 1100 - (now - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

// Returns { lat, lon, bbox: [south, west, north, east], displayName }
async function geocode(place) {
  if (!place || !place.trim()) throw new Error('Please enter a city/area name.');
  await politeWait();
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(place.trim())}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch {
    throw new Error('Could not reach the map server. Check your internet connection and try again.');
  }
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status}). Try again in a moment.`);
  const data = await res.json();
  if (!data.length) throw new Error(`Could not find "${place}". Try a nearby bigger city, e.g. "Lahore".`);
  const r = data[0];
  // Nominatim boundingbox = [south, north, west, east] as strings
  const bb = r.boundingbox.map(Number);
  return {
    lat: Number(r.lat),
    lon: Number(r.lon),
    bbox: [bb[0], bb[2], bb[1], bb[3]], // -> [south, west, north, east]
    displayName: r.display_name,
  };
}

module.exports = { geocode };
