// AI criteria filtering via the Google Gemini API free tier.
// Key comes from GEMINI_API_KEY in .env (never logged). No key -> clear error.

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const BATCH_SIZE = 40;

function getApiKey() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key || key === 'PASTE_YOUR_FREE_KEY_HERE') {
    throw new Error(
      'Gemini API key is missing. Get a FREE key at https://aistudio.google.com/apikey ' +
      '(sign in with Google -> "Create API key"), then put it in the .env file as GEMINI_API_KEY=...'
    );
  }
  return key;
}

function compactLead(lead) {
  return {
    id: lead.id,
    name: lead.name,
    category: lead.category,
    address: lead.address,
    hasPhone: !!lead.phone,
    hasWebsite: !!lead.website,
    hours: lead.hours || '',
  };
}

function buildPrompt(leads, criteria) {
  return (
    'You are filtering a B2B lead list. The user sells cleaning supplies wholesale and wants to pitch these businesses on WhatsApp.\n' +
    'User criteria (plain words): "' + criteria + '"\n\n' +
    'Leads (JSON array):\n' + JSON.stringify(leads.map(compactLead)) + '\n\n' +
    'Reply with STRICT JSON only, no markdown, no extra text, in exactly this shape:\n' +
    '{"keep":[{"id":<lead id>,"reason":"<one short line why it fits>"}]}\n' +
    'Rules: keep ONLY leads matching the criteria; use the exact numeric ids given; keep the list as long as needed.'
  );
}

// Defensive: strip code fences / junk, then JSON.parse. Throws a friendly error.
function parseFilterResponse(text) {
  if (!text || !text.trim()) throw new Error('Gemini returned an empty reply. Try again.');
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini reply was not valid JSON. Try again.');
  }
  cleaned = cleaned.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Could not understand the Gemini reply. Try again.');
  }
  const keep = parsed.keep || parsed.kept || parsed.results || [];
  if (!Array.isArray(keep)) throw new Error('Gemini reply had an unexpected shape. Try again.');
  return keep
    .map((k) => ({ id: Number(k.id), reason: String(k.reason || k.why || '').slice(0, 200) }))
    .filter((k) => Number.isFinite(k.id));
}

// Resolve the best available model at runtime: Google shuts down old model
// names (e.g. gemini-2.0-flash -> HTTP 404), so we ask the API which
// flash models exist and pick the best free-tier one. Explicit GEMINI_MODEL
// in .env always wins. Result is cached for the process lifetime.
let cachedModel = null;
async function resolveModel(apiKey) {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (cachedModel) return cachedModel;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name).replace(/^models\//, ''))
      .filter((n) => /flash/i.test(n) && !/tts|image|live|transcribe/i.test(n));
    const rank = (n) => (/flash-lite$/i.test(n) && !/preview/i.test(n) ? 0 : !/preview/i.test(n) ? 1 : 2);
    names.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }));
    if (names[0]) cachedModel = names[0];
  } catch {
    // fall through to default below
  }
  if (!cachedModel) cachedModel = DEFAULT_MODEL;
  return cachedModel;
}

async function filterBatch(leads, criteria, apiKey) {
  const model = await resolveModel(apiKey);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(leads, criteria) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 400 && /key/i.test(body)) {
      throw new Error('Gemini rejected the API key. Check GEMINI_API_KEY in your .env file.');
    }
    if (res.status === 429) {
      throw new Error('Gemini free-tier limit hit. Wait a minute and try again (or use a shorter list).');
    }
    if (res.status === 404) {
      cachedModel = null; // force re-discovery next time
      throw new Error('Gemini model not available (HTTP 404). Try again — the app auto-picks a working model. If it persists, set GEMINI_MODEL in .env to a model from https://ai.google.dev/gemini-api/docs/models');
    }
    throw new Error(`Gemini request failed (HTTP ${res.status}). Try again.`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return parseFilterResponse(text);
}

// Returns [{ id, reason }] for the leads to keep.
// onProgress (optional) is called after each batch with
// { done, total, batch, batches, keptSoFar } for live UI animation.
async function filterLeads(leads, criteria, onProgress) {
  if (!criteria || !criteria.trim()) throw new Error('Please type your criteria first.');
  if (!leads.length) throw new Error('No leads to filter.');
  const apiKey = getApiKey();
  const kept = [];
  const batches = Math.ceil(leads.length / BATCH_SIZE);
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const result = await filterBatch(batch, criteria.trim(), apiKey);
    const ids = new Set(batch.map((l) => l.id));
    kept.push(...result.filter((k) => ids.has(k.id)));
    if (onProgress) {
      onProgress({
        done: i + batch.length,
        total: leads.length,
        batch: i / BATCH_SIZE + 1,
        batches,
        keptSoFar: kept.length,
      });
    }
    if (i + BATCH_SIZE < leads.length) await new Promise((r) => setTimeout(r, 1200)); // polite pacing
  }
  return kept;
}

module.exports = { filterLeads, parseFilterResponse, buildPrompt };
