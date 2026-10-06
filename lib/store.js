// Tiny JSON-file store (no native DB modules, so it installs cleanly on Windows).
// File: data/db.json  — campaigns, leads, send log, do-not-message set.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function blank() {
  return { campaigns: {}, sendLog: [], doNotMessage: [] };
}

function load() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(raw);
    if (!db.campaigns) db.campaigns = {};
    if (!db.sendLog) db.sendLog = [];
    if (!db.doNotMessage) db.doNotMessage = [];
    return db;
  } catch {
    return blank();
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// --- campaigns ---------------------------------------------------------------
function createCampaign({ city, type, criteria, template, leads }) {
  const db = load();
  const id = 'c' + Date.now().toString(36);
  db.campaigns[id] = {
    id,
    createdAt: new Date().toISOString(),
    city, type, criteria, template,
    leads, // final approved leads
    status: 'ready', // ready | sending | stopped | done
    sentCount: 0,
    progress: [], // live log lines
  };
  save(db);
  return id;
}

function getCampaign(id) {
  return load().campaigns[id] || null;
}

function updateCampaign(id, patch) {
  const db = load();
  if (!db.campaigns[id]) return null;
  Object.assign(db.campaigns[id], patch);
  save(db);
  return db.campaigns[id];
}

function logProgress(id, line) {
  const db = load();
  const c = db.campaigns[id];
  if (!c) return;
  c.progress.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  if (c.progress.length > 500) c.progress = c.progress.slice(-500);
  save(db);
}

// --- send log / caps ----------------------------------------------------------
function logSend({ campaignId, leadId, name, phone, status, note }) {
  const db = load();
  db.sendLog.push({ at: new Date().toISOString(), campaignId, leadId, name, phone, status, note: note || '' });
  save(db);
}

// Sends in the last 24h with status 'sent'.
function sendsLast24h() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return load().sendLog.filter((e) => e.status === 'sent' && new Date(e.at).getTime() > cutoff).length;
}

function addDoNotMessage(phone) {
  const db = load();
  if (!db.doNotMessage.includes(phone)) db.doNotMessage.push(phone);
  save(db);
}

function isDoNotMessage(phone) {
  return load().doNotMessage.includes(phone);
}

module.exports = {
  createCampaign, getCampaign, updateCampaign, logProgress,
  logSend, sendsLast24h, addDoNotMessage, isDoNotMessage, load, save,
};
