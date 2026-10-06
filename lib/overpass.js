// Business discovery via the free Overpass API (OpenStreetMap data).
// One polite query per run (60s timeout). No API key needed.

// Public Overpass mirrors, tried in order until one answers.
// (Main instance is under heavy load / blocks some networks at times.)
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const USER_AGENT = 'lead-pitcher/1.0 (free B2B lead tool; contact: local user)';
const MAX_RESULTS = 500;
const MIRROR_TIMEOUT_MS = 30000;

// Business-type text -> OSM tag pairs. Add more freely: { key: 'value' }.
const CATEGORY_MAP = {
  hotel:       [{ k: 'tourism', v: 'hotel' }, { k: 'tourism', v: 'guest_house' }, { k: 'tourism', v: 'hostel' }, { k: 'tourism', v: 'motel' }],
  restaurant:  [{ k: 'amenity', v: 'restaurant' }, { k: 'amenity', v: 'fast_food' }],
  cafe:        [{ k: 'amenity', v: 'cafe' }],
  hospital:    [{ k: 'amenity', v: 'hospital' }],
  clinic:      [{ k: 'amenity', v: 'clinic' }, { k: 'amenity', v: 'doctors' }, { k: 'amenity', v: 'dentist' }],
  pharmacy:    [{ k: 'amenity', v: 'pharmacy' }],
  school:      [{ k: 'amenity', v: 'school' }, { k: 'amenity', v: 'college' }, { k: 'amenity', v: 'university' }],
  gym:         [{ k: 'leisure', v: 'fitness_centre' }],
  bank:        [{ k: 'amenity', v: 'bank' }],
  office:      [{ k: 'office', v: '*' }],              // any office=* (company, estate_agent, ...)
  factory:     [{ k: 'building', v: 'industrial' }, { k: 'man_made', v: 'works' }],
  industrial:  [{ k: 'building', v: 'industrial' }, { k: 'man_made', v: 'works' }],
  mall:        [{ k: 'shop', v: 'mall' }, { k: 'shop', v: 'department_store' }],
  supermarket: [{ k: 'shop', v: 'supermarket' }, { k: 'shop', v: 'convenience' }],
  bakery:      [{ k: 'shop', v: 'bakery' }],
  salon:       [{ k: 'shop', v: 'hairdresser' }, { k: 'shop', v: 'beauty' }],
};

// Aliases so the user can type natural words.
const ALIASES = {
  hotels: 'hotel', guesthouse: 'hotel', motel: 'hotel', hostel: 'hotel',
  restaurants: 'restaurant', resturant: 'restaurant', food: 'restaurant',
  cafes: 'cafe', coffee: 'cafe',
  hospitals: 'hospital',
  clinics: 'clinic', doctors: 'clinic', dental: 'clinic',
  pharmacies: 'pharmacy', medicalstore: 'pharmacy', 'medical store': 'pharmacy',
  schools: 'school', colleges: 'school', universities: 'school',
  gyms: 'gym', fitness: 'gym',
  banks: 'bank',
  offices: 'office', corporate: 'office',
  factories: 'factory', industry: 'industrial',
  malls: 'mall', plaza: 'mall', shopping: 'mall',
  supermarkets: 'supermarket', grocery: 'supermarket', mart: 'supermarket',
  bakeries: 'bakery',
  salons: 'salon', barber: 'salon', parlour: 'salon', parlor: 'salon',
};

function resolveCategory(type) {
  const t = (type || '').trim().toLowerCase();
  if (CATEGORY_MAP[t]) return { key: t, tags: CATEGORY_MAP[t] };
  if (ALIASES[t] && CATEGORY_MAP[ALIASES[t]]) return { key: ALIASES[t], tags: CATEGORY_MAP[ALIASES[t]] };
  return null; // -> fall back to name-regex search
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQuery(resolved, rawType, bbox) {
  const [s, w, n, e] = bbox;
  const bb = `${s},${w},${n},${e}`;
  let selector;
  if (resolved) {
    selector = resolved.tags.map(({ k, v }) => `nwr["${k}"="${v}"](${bb});`).join('\n  ');
  } else {
    // Unmapped type: case-insensitive match on the business name inside the area.
    const pattern = escapeRegex(rawType.trim());
    selector = `nwr["name"~"${pattern}",i](${bb});`;
  }
  return `[out:json][timeout:60];
(
  ${selector}
);
out tags center ${MAX_RESULTS};`;
}

function pickTag(tags, ...keys) {
  for (const k of keys) if (tags[k]) return tags[k];
  return '';
}

function formatAddress(tags) {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:suburb'] || tags['addr:neighbourhood'],
    tags['addr:city'] || tags['addr:town'],
  ].filter(Boolean);
  return parts.join(', ');
}

function toLead(el, idx) {
  const tags = el.tags || {};
  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;
  return {
    id: idx,
    name: tags.name || '(unnamed)',
    category: pickTag(tags, 'tourism', 'amenity', 'shop', 'office', 'leisure', 'building', 'man_made'),
    address: formatAddress(tags),
    phone: pickTag(tags, 'phone', 'contact:phone'),
    website: pickTag(tags, 'website', 'contact:website'),
    hours: pickTag(tags, 'opening_hours'),
    lat, lon,
    osmType: el.type, osmId: el.id,
  };
}

// bbox = [south, west, north, east]. Returns array of leads.
// Tries each mirror in turn; the main instance is often overloaded,
// so failover to community mirrors is normal, not an error.
// onStage (optional) receives {key, label} progress updates for live UI animation.
function shortHost(url) {
  try {
    return new URL(url).hostname.replace(/^overpass\./, '');
  } catch {
    return url;
  }
}

async function tryMirror(url, query, onStage) {
  const stage = (s) => { if (onStage) onStage(s); };
  // Two attempts per mirror: if the server says "busy" (429/504),
  // wait 20s and retry once before moving to the next mirror.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (res.status === 429 || res.status === 504) {
        if (attempt === 1) {
          stage({ key: 'wait', label: 'Server busy — waiting 20s, then retrying…' });
          await new Promise((r) => setTimeout(r, 20000));
          continue;
        }
        throw new Error('busy (rate limited)');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('server returned an error page instead of data');
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('busy (rate limited)');
}

async function findBusinesses(rawType, bbox, onStage) {
  const stage = (s) => { if (onStage) onStage(s); };
  const resolved = resolveCategory(rawType);
  const query = buildQuery(resolved, rawType, bbox);
  const failures = [];
  for (let i = 0; i < OVERPASS_MIRRORS.length; i++) {
    const url = OVERPASS_MIRRORS[i];
    const host = shortHost(url);
    stage({ key: 'mirror', label: `Trying map server ${i + 1}/${OVERPASS_MIRRORS.length} (${host})…` });
    try {
      const data = await tryMirror(url, query, onStage);
      stage({ key: 'received', label: `Got data from ${host}` });
      const elements = (data.elements || []).filter((el) => el.tags && el.tags.name);
      stage({ key: 'parse', label: `Reading ${elements.length} businesses…` });
      return elements.slice(0, MAX_RESULTS).map((el, idx) => toLead(el, idx));
    } catch (err) {
      failures.push(`${url}: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
    }
  }
  throw new Error(
    'Could not reach any Overpass map server. The main server is under heavy load right now; ' +
    'wait a few minutes and try again. Tried: ' + failures.join(' | ')
  );
}

module.exports = { findBusinesses, resolveCategory, toLead, CATEGORY_MAP };
