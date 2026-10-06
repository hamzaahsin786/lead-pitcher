// Dry-run script for testing steps 1-2 (search + geocode) without the web UI.
// Usage: node scripts/dryrun.js [city] [type]
// Example: node scripts/dryrun.js Lahore hotels
const { geocode } = require('../lib/geocode');
const { findBusinesses } = require('../lib/overpass');

(async () => {
  const city = process.argv[2] || 'Lahore';
  const type = process.argv[3] || 'hotels';
  console.log(`Geocoding "${city}"...`);
  const geo = await geocode(city);
  console.log('->', geo.displayName);
  console.log(`Searching Overpass for "${type}"...`);
  const leads = await findBusinesses(type, geo.bbox);
  console.log(`-> ${leads.length} businesses found.`);
  const withPhone = leads.filter((l) => l.phone).length;
  console.log(`-> ${withPhone} have a phone number.`);
  console.log('\nSample rows:');
  leads.slice(0, 5).forEach((l, i) => {
    console.log(`${i + 1}. ${l.name} | ${l.category} | ${l.address || 'no address'} | phone: ${l.phone || '—'} | site: ${l.website || '—'}`);
  });
})().catch((err) => { console.error('DRY RUN FAILED:', err.message); process.exit(1); });
