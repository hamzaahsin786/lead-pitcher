// lead-pitcher server — runs on localhost only (127.0.0.1).
require('dotenv').config();
const express = require('express');
const path = require('path');

const { geocode } = require('./lib/geocode');
const { findBusinesses, resolveCategory } = require('./lib/overpass');
const { filterLeads } = require('./lib/filter');
const store = require('./lib/store');
const sender = require('./lib/sender');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- 1. Find businesses --------------------------------------------------------
app.post('/api/search', asyncHandler(async (req, res) => {
  const { city, type } = req.body || {};
  if (!city || !type) return res.status(400).json({ error: 'City and business type are both required.' });
  const geo = await geocode(city);                    // throws friendly error if not found
  const leads = await findBusinesses(type, geo.bbox); // throws friendly error on Overpass issues
  const resolved = resolveCategory(type);
  res.json({
    displayName: geo.displayName,
    matchedCategory: resolved ? resolved.key : `name search for "${type}"`,
    count: leads.length,
    leads,
  });
}));

// --- 2. AI criteria filter ------------------------------------------------------
app.post('/api/filter', asyncHandler(async (req, res) => {
  const { leads, criteria } = req.body || {};
  if (!leads || !leads.length) return res.status(400).json({ error: 'Find businesses first.' });
  const keep = await filterLeads(leads, criteria); // throws friendly error if key missing
  const byId = new Map(leads.map((l) => [l.id, l]));
  res.json({
    kept: keep.filter((k) => byId.has(k.id)).map((k) => ({ ...byId.get(k.id), reason: k.reason })),
    dropped: leads.length - keep.length,
  });
}));

// --- 2b. SSE: live animated stages for search + filter ----------------------------
// Same results as the POST endpoints above, but streams `stage` events first so
// the UI can animate what the backend is doing. Old endpoints kept for compat.
function sseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
}
function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
// Runs an SSE handler: heartbeat every 15s (mirror attempts can take 30s),
// any thrown error becomes an `error` event — the connection never hangs.
function sseRoute(handler) {
  return async (req, res) => {
    sseHeaders(res);
    const hb = setInterval(() => { try { sseSend(res, 'ping', {}); } catch { /* gone */ } }, 15000);
    req.on('close', () => clearInterval(hb));
    try {
      await handler(req, (event, data) => sseSend(res, event, data));
    } catch (err) {
      console.error('API error:', err.message);
      try { sseSend(res, 'error', { error: err.message || 'Something went wrong.' }); } catch { /* gone */ }
    }
    clearInterval(hb);
    res.end();
  };
}

app.get('/api/search/stream', sseRoute(async (req, send) => {
  const { city, type } = req.query || {};
  if (!city || !type) throw new Error('City and business type are both required.');
  send('stage', { key: 'geocode', label: `Locating "${city}" on the map…` });
  const geo = await geocode(city); // throws friendly error if not found
  const leads = await findBusinesses(type, geo.bbox, (s) => send('stage', s)); // streams mirror stages
  const resolved = resolveCategory(type);
  send('done', {
    displayName: geo.displayName,
    matchedCategory: resolved ? resolved.key : `name search for "${type}"`,
    count: leads.length,
    leads,
  });
}));

app.post('/api/filter/stream', sseRoute(async (req, send) => {
  const { leads, criteria } = req.body || {};
  if (!leads || !leads.length) throw new Error('Find businesses first.');
  send('stage', { key: 'start', label: 'Asking Gemini to apply your criteria…' });
  const keep = await filterLeads(leads, criteria, (p) => {
    send('stage', {
      key: 'batch',
      label: `AI reviewing businesses… ${p.done}/${p.total}`,
      done: p.done,
      total: p.total,
    });
  });
  const byId = new Map(leads.map((l) => [l.id, l]));
  send('done', {
    kept: keep.filter((k) => byId.has(k.id)).map((k) => ({ ...byId.get(k.id), reason: k.reason })),
    dropped: leads.length - keep.length,
  });
}));

// --- 3. Approve final list -> creates a campaign (review-first gate) -------------
app.post('/api/approve', asyncHandler(async (req, res) => {
  const { city, type, criteria, template, leads } = req.body || {};
  if (!leads || !leads.length) return res.status(400).json({ error: 'No leads selected.' });
  if (!template || !template.trim()) return res.status(400).json({ error: 'Please write your pitch message first.' });
  const id = store.createCampaign({ city, type, criteria, template: template.trim(), leads });
  res.json({ campaignId: id, count: leads.length });
}));

// --- 4. WhatsApp connection ------------------------------------------------------
app.post('/api/whatsapp/start', asyncHandler(async (req, res) => {
  sender.getClient(); // lazy: only now does whatsapp-web.js load
  res.json(sender.whatsappStatus());
}));
app.get('/api/whatsapp/status', (req, res) => res.json(sender.whatsappStatus()));
app.get('/api/whatsapp/qr', (req, res) => res.json({ qr: sender.getQrDataUrl() }));

// --- 5. Sending ------------------------------------------------------------------
app.post('/api/send/start', asyncHandler(async (req, res) => {
  const { campaignId } = req.body || {};
  const campaign = store.getCampaign(campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  const st = sender.whatsappStatus();
  if (!st.ready) return res.status(400).json({ error: 'WhatsApp is not connected yet. Scan the QR code first.' });
  if (campaign.status === 'sending') return res.status(400).json({ error: 'Already sending.' });
  // Fire and forget — progress is polled from /api/campaign/:id
  sender.runCampaign(campaignId, sender.getClient()).catch((err) => {
    store.logProgress(campaignId, 'Sender crashed: ' + String(err.message || err).slice(0, 120));
    store.updateCampaign(campaignId, { status: 'stopped' });
  });
  res.json({ ok: true });
}));
app.post('/api/send/stop', asyncHandler(async (req, res) => {
  const { campaignId } = req.body || {};
  store.updateCampaign(campaignId, { status: 'stopped' });
  store.logProgress(campaignId, 'Stop requested.');
  res.json({ ok: true });
}));
app.get('/api/campaign/:id', (req, res) => {
  const c = store.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found.' });
  res.json({ ...c, limits: { daily: sender.DAILY_LIMIT, minDelay: sender.MIN_DELAY_SEC, maxDelay: sender.MAX_DELAY_SEC } });
});

// --- 6. Export CSV -----------------------------------------------------------------
function csvCell(v) {
  const s = String(v ?? '').replace(/"/g, '""');
  return `"${s}"`;
}
app.get('/api/export/:id', (req, res) => {
  const c = store.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found.' });
  const rows = [['Name', 'Category', 'Address', 'Phone', 'Website', 'Hours', 'AI reason']];
  for (const l of c.leads) rows.push([l.name, l.category, l.address, l.phone, l.website, l.hours, l.reason || ''].map(csvCell));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads-${c.id}.csv"`);
  res.send('\uFEFF' + rows.map((r) => r.join(',')).join('\n')); // BOM so Excel opens Urdu/UTF-8 correctly
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Friendly error JSON for every route above.
app.use((err, req, res, _next) => {
  console.error('API error:', err.message);
  res.status(500).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`lead-pitcher running at http://localhost:${PORT}`);
  console.log(`Daily limit: ${sender.DAILY_LIMIT} | Delays: ${sender.MIN_DELAY_SEC}-${sender.MAX_DELAY_SEC}s | Dry run: ${sender.DRY_RUN}`);
});
