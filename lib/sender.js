// WhatsApp sending via whatsapp-web.js (unofficial WhatsApp Web automation).
// - whatsapp-web.js is required LAZILY inside connect(), so the server boots
//   fine even before the user ever connects WhatsApp.
// - DRY_RUN=true env: logs "would send" instead of sending (for testing).
// - Ban-risk safety: random human-like delays, daily cap, review-first flow.

const qrcode = require('qrcode');
const store = require('./store');

const DRY_RUN = /^true$/i.test(process.env.DRY_RUN || '');
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 40);
const MIN_DELAY_SEC = Number(process.env.MIN_DELAY_SEC || 45);
const MAX_DELAY_SEC = Number(process.env.MAX_DELAY_SEC || 90);

// --- phone normalization ------------------------------------------------------
// Pakistani formats handled: 0300 1234567, +92 300 1234567, 92 300 1234567,
// 0092 300 1234567, 3001234567. Returns digits-only international format or ''.
function normalizePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);              // 0092... -> 92...
  if (d.startsWith('0') && d.length === 11) d = '92' + d.slice(1); // 0300... -> 92300...
  if (d.length === 10 && d.startsWith('3')) d = '92' + d;           // 3001234567 -> 923001234567
  return d;
}

function personalize(template, lead) {
  return String(template || '').replaceAll('{name}', lead.name || 'there');
}

function randomDelayMs() {
  const lo = Math.min(MIN_DELAY_SEC, MAX_DELAY_SEC) * 1000;
  const hi = Math.max(MIN_DELAY_SEC, MAX_DELAY_SEC) * 1000;
  return lo + Math.random() * (hi - lo);
}

// --- WhatsApp client (singleton, lazy) ----------------------------------------
let client = null;
let latestQr = null;
let ready = false;

function getClient() {
  if (client) return client;
  // Lazy require: keeps `node server.js` bootable without touching WhatsApp.
  const { Client, LocalAuth } = require('whatsapp-web.js');
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }), // QR scanned once, session persists
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] },
  });
  client.on('qr', async (qr) => {
    latestQr = await qrcode.toDataURL(qr); // shown in the web UI
    ready = false;
  });
  client.on('ready', () => { ready = true; latestQr = null; });
  client.on('disconnected', () => { ready = false; latestQr = null; });
  client.initialize();
  return client;
}

function whatsappStatus() {
  return { initialized: !!client, ready, hasQr: !!latestQr };
}
function getQrDataUrl() { return latestQr; }

// --- sending loop --------------------------------------------------------------
// sendJob: { campaignId, client } — stop via store.updateCampaign(id, {status:'stopped'})
async function runCampaign(campaignId, waClient) {
  const campaign = store.getCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found.');
  store.updateCampaign(campaignId, { status: 'sending' });
  store.logProgress(campaignId, `Sending started. Daily limit ${DAILY_LIMIT}, delays ${MIN_DELAY_SEC}-${MAX_DELAY_SEC}s.`);

  for (const lead of campaign.leads) {
    const cur = store.getCampaign(campaignId);
    if (!cur || cur.status !== 'sending') {
      store.logProgress(campaignId, 'Stopped by user.');
      return;
    }
    const phone = normalizePhone(lead.phone);
    if (!phone) {
      store.logSend({ campaignId, leadId: lead.id, name: lead.name, phone: '', status: 'skipped', note: 'no phone number' });
      store.logProgress(campaignId, `Skipped ${lead.name}: no phone number.`);
      continue;
    }
    if (store.isDoNotMessage(phone)) {
      store.logSend({ campaignId, leadId: lead.id, name: lead.name, phone, status: 'skipped', note: 'do-not-message list' });
      store.logProgress(campaignId, `Skipped ${lead.name}: already messaged before.`);
      continue;
    }
    if (store.sendsLast24h() >= DAILY_LIMIT) {
      store.logProgress(campaignId, `Daily limit of ${DAILY_LIMIT} reached. Stopping for today.`);
      store.updateCampaign(campaignId, { status: 'stopped' });
      return;
    }
    const message = personalize(campaign.template, lead);
    try {
      if (DRY_RUN) {
        store.logProgress(campaignId, `[DRY RUN] Would send to ${lead.name} (${phone}): "${message.slice(0, 60)}..."`);
      } else {
        const numberId = await waClient.getNumberId(phone); // verify the number is on WhatsApp
        if (!numberId) {
          store.logSend({ campaignId, leadId: lead.id, name: lead.name, phone, status: 'skipped', note: 'not on WhatsApp' });
          store.logProgress(campaignId, `Skipped ${lead.name}: number not on WhatsApp.`);
          continue;
        }
        await waClient.sendMessage(numberId._serialized, message);
      }
      store.logSend({ campaignId, leadId: lead.id, name: lead.name, phone, status: 'sent', note: DRY_RUN ? 'dry-run' : '' });
      store.addDoNotMessage(phone); // never message the same number twice
      const updated = store.getCampaign(campaignId);
      store.updateCampaign(campaignId, { sentCount: (updated.sentCount || 0) + 1 });
      store.logProgress(campaignId, `Sent to ${lead.name} (${phone}).`);
    } catch (err) {
      store.logSend({ campaignId, leadId: lead.id, name: lead.name, phone, status: 'failed', note: String(err.message || err).slice(0, 120) });
      store.logProgress(campaignId, `Failed to send to ${lead.name}: ${String(err.message || err).slice(0, 80)}`);
    }
    const waitMs = randomDelayMs();
    store.logProgress(campaignId, `Waiting ${Math.round(waitMs / 1000)}s before next message...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  store.updateCampaign(campaignId, { status: 'done' });
  store.logProgress(campaignId, 'Campaign finished.');
}

module.exports = {
  normalizePhone, personalize, getClient, whatsappStatus, getQrDataUrl, runCampaign,
  DAILY_LIMIT, MIN_DELAY_SEC, MAX_DELAY_SEC, DRY_RUN,
};
