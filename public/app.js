/* lead-pitcher — plain vanilla JS, no frameworks */
let rawLeads = [];      // from Overpass
let filteredLeads = []; // after AI filter
let finalLeads = [];    // checked rows, approved
let campaignId = null;
let pollTimer = null;

const $ = (id) => document.getElementById(id);

const DEFAULT_TEMPLATE =
  "Hi {name}! I'm Muhammad — I supply wholesale cleaning items (detergents, disinfectants, tissue paper & more) to businesses in Lahore at factory rates. Can I send you our price list? Reply STOP to opt out.";
$('template').value = DEFAULT_TEMPLATE;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function setStatus(id, msg, isError) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'status ' + (isError ? 'error' : 'ok');
}
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* Animated activity feed: every backend action shows as animated rows.
   stage() adds a new spinner row and flips the previous one to a green check.
   progress() drives an animated shimmer bar. done()/error() close the feed. */
function ActivityFeed(el) {
  this.el = el;
  this.el.innerHTML = '';
}
ActivityFeed.prototype._current = function () {
  return this.el.querySelector('.act-row.active');
};
ActivityFeed.prototype._finishRow = function (row, ok) {
  row.classList.remove('active');
  const sp = row.querySelector('.spinner');
  if (sp) sp.outerHTML = ok ? '<span class="act-check">✓</span>' : '<span class="act-x">✕</span>';
  const dots = row.querySelector('.dots');
  if (dots) dots.remove();
};
ActivityFeed.prototype.stage = function (key, label) {
  const cur = this._current();
  if (cur) { this._finishRow(cur, true); cur.classList.add('done'); }
  const row = document.createElement('div');
  row.className = 'act-row active';
  const sp = document.createElement('span'); sp.className = 'spinner';
  const lab = document.createElement('span'); lab.className = 'act-label'; lab.textContent = label;
  const dots = document.createElement('span'); dots.className = 'dots'; dots.setAttribute('aria-hidden', 'true');
  dots.innerHTML = '<i></i><i></i><i></i>';
  row.append(sp, lab, dots);
  this.el.appendChild(row);
};
ActivityFeed.prototype.progress = function (done, total) {
  let bar = this.el.querySelector('.act-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'act-progress';
    bar.innerHTML = '<div class="act-bar"><div class="act-fill"></div></div><span class="act-count"></span>';
    this.el.appendChild(bar);
  }
  const pct = total ? Math.round((done / total) * 100) : 0;
  bar.querySelector('.act-fill').style.width = pct + '%';
  bar.querySelector('.act-count').textContent = done + '/' + total;
};
ActivityFeed.prototype.done = function (label) {
  const cur = this._current();
  if (cur) {
    this._finishRow(cur, true); cur.classList.add('done');
    cur.querySelector('.act-label').textContent = label;
  } else {
    const row = document.createElement('div');
    row.className = 'act-row done';
    const chk = document.createElement('span'); chk.className = 'act-check'; chk.textContent = '✓';
    const lab = document.createElement('span'); lab.className = 'act-label'; lab.textContent = label;
    row.append(chk, lab);
    this.el.appendChild(row);
  }
};
ActivityFeed.prototype.error = function (msg) {
  const cur = this._current();
  if (cur) this._finishRow(cur, false);
  const row = document.createElement('div');
  row.className = 'act-row failed-msg';
  const lab = document.createElement('span'); lab.className = 'act-label'; lab.textContent = msg;
  row.appendChild(lab);
  this.el.appendChild(row);
};

/* Consume an SSE endpoint with fetch + ReadableStream (works for GET and POST,
   unlike EventSource). onEvent(name, data) — throw inside it to abort. */
async function streamSSE(url, opts, onEvent) {
  const res = await fetch(url, {
    method: (opts && opts.method) || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let name = 'message', data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data || name === 'ping') continue;
      onEvent(name, JSON.parse(data));
    }
  }
}
function leadTable(leads, withCheckboxes, withReasons) {
  if (!leads.length) return '<p class="hint">Nothing here.</p>';
  let h = '<table><thead><tr>';
  if (withCheckboxes) h += '<th><input type="checkbox" id="checkAll" checked title="Select all"></th>';
  h += '<th>Name</th><th>Category</th><th>Address</th><th>Phone</th>';
  if (withReasons) h += '<th>Why it fits</th>';
  h += '</tr></thead><tbody>';
  leads.forEach((l, i) => {
    h += '<tr>';
    if (withCheckboxes) h += `<td><input type="checkbox" class="leadcheck" data-i="${i}" checked></td>`;
    h += `<td><b>${esc(l.name)}</b>${l.website ? ` <a href="${esc(l.website)}" target="_blank" rel="noopener">🌐</a>` : ''}</td>`;
    h += `<td>${esc(l.category)}</td><td>${esc(l.address)}</td><td>${esc(l.phone || '—')}</td>`;
    if (withReasons) h += `<td class="reason">${esc(l.reason || '')}</td>`;
    h += '</tr>';
  });
  return h + '</tbody></table>';
}

/* --- Step 1: search (streams live backend stages) --- */
$('btnSearch').onclick = async () => {
  const city = $('city').value.trim();
  const type = $('typeCustom').value.trim() || $('type').value;
  if (!city || !type) { setStatus('searchStatus', 'City and business type are both required.', true); return; }
  const feed = new ActivityFeed($('searchActivity'));
  $('btnSearch').disabled = true;
  setStatus('searchStatus', '');
  $('results1').innerHTML = '';
  $('step2').hidden = true;
  try {
    await streamSSE(
      '/api/search/stream?city=' + encodeURIComponent(city) + '&type=' + encodeURIComponent(type),
      null,
      (ev, data) => {
        if (ev === 'stage') feed.stage(data.key, data.label);
        else if (ev === 'done') {
          rawLeads = data.leads;
          feed.done(`Found ${data.count} businesses`);
          setStatus('searchStatus', `Found ${data.count} businesses in ${data.displayName.split(',').slice(0, 2).join(',')} (${data.matchedCategory}).`);
          $('results1').innerHTML = leadTable(rawLeads, false, false);
          $('step2').hidden = false;
        } else if (ev === 'error') { throw new Error(data.error); }
      }
    );
  } catch (e) {
    feed.error(e.message);
    setStatus('searchStatus', e.message, true);
  } finally {
    $('btnSearch').disabled = false;
  }
};

/* --- Step 2: AI filter (streams live backend stages + progress) --- */
$('btnFilter').onclick = async () => {
  const criteria = $('criteria').value.trim();
  if (!criteria) { setStatus('filterStatus', 'Please type your criteria first.', true); return; }
  const feed = new ActivityFeed($('filterActivity'));
  $('btnFilter').disabled = true;
  setStatus('filterStatus', '');
  $('results2').innerHTML = '';
  $('step3').hidden = true;
  try {
    await streamSSE('/api/filter/stream', { method: 'POST', body: { leads: rawLeads, criteria } }, (ev, data) => {
      if (ev === 'stage') {
        feed.stage(data.key, data.label);
        if (data.key === 'batch' && data.total) feed.progress(data.done, data.total);
      } else if (ev === 'done') {
        filteredLeads = data.kept;
        feed.done(`Kept ${filteredLeads.length} of ${rawLeads.length}`);
        setStatus('filterStatus', `Kept ${filteredLeads.length} of ${rawLeads.length} (${data.dropped} dropped). Uncheck anyone you don't want, then approve.`);
        $('results2').innerHTML = leadTable(filteredLeads, true, true);
        $('step3').hidden = false;
        const checkAll = $('checkAll');
        if (checkAll) checkAll.onchange = () => document.querySelectorAll('.leadcheck').forEach((c) => (c.checked = checkAll.checked));
      } else if (ev === 'error') { throw new Error(data.error); }
    });
  } catch (e) {
    feed.error(e.message);
    setStatus('filterStatus', e.message, true);
  } finally {
    $('btnFilter').disabled = false;
  }
};

/* --- Step 2b: skip AI filter (use the full list as-is) --- */
$('btnSkip').onclick = () => {
  if (!rawLeads.length) { setStatus('filterStatus', 'Find businesses first.', true); return; }
  const feed = new ActivityFeed($('filterActivity'));
  filteredLeads = rawLeads;
  feed.done(`Skipped AI filter — using all ${rawLeads.length} businesses`);
  setStatus('filterStatus', `Using all ${rawLeads.length} businesses without AI filtering. Uncheck anyone you don't want, then approve.`);
  $('results2').innerHTML = leadTable(filteredLeads, true, false);
  $('step3').hidden = false;
  const checkAll = $('checkAll');
  if (checkAll) checkAll.onchange = () => document.querySelectorAll('.leadcheck').forEach((c) => (c.checked = checkAll.checked));
};
$('btnApprove').onclick = async () => {
  finalLeads = [...document.querySelectorAll('.leadcheck')]
    .filter((c) => c.checked)
    .map((c) => filteredLeads[Number(c.dataset.i)]);
  if (!finalLeads.length) return setStatus('approveStatus', 'Select at least one business.', true);
  if (!$('template').value.trim()) return setStatus('approveStatus', 'Write your pitch message first.', true);
  setStatus('approveStatus', 'Saving…');
  try {
    const data = await post('/api/approve', {
      city: $('city').value.trim(),
      type: $('typeCustom').value.trim() || $('type').value,
      criteria: $('criteria').value.trim(),
      template: $('template').value,
      leads: finalLeads,
    });
    campaignId = data.campaignId;
    setStatus('approveStatus', `Approved ${data.count} businesses. Now connect WhatsApp below — nothing sends until YOU press "Start sending".`);
    $('step4').hidden = false;
    $('results3').innerHTML = '';
  } catch (e) { setStatus('approveStatus', e.message, true); }
};

/* --- Step 4: WhatsApp (animated QR pop-in, scan pulse, draw-in checkmark) --- */
let qrTimer = null, statusTimer = null;
$('btnConnect').onclick = async () => {
  $('btnConnect').disabled = true;
  $('waCheck').hidden = true; $('waCheck').classList.remove('show');
  $('scanPulse').hidden = true;
  try {
    await post('/api/whatsapp/start', {});
    setStatus('waStatus', 'Loading WhatsApp… scan the QR when it appears.');
    clearInterval(qrTimer); clearInterval(statusTimer);
    let qrShown = false;
    qrTimer = setInterval(async () => {
      const r = await fetch('/api/whatsapp/qr').then((x) => x.json());
      if (r.qr && !qrShown) {
        qrShown = true;
        $('qr').src = r.qr;
        $('qr').hidden = false;
        const wrap = $('qrWrap');
        wrap.classList.remove('pop'); void wrap.offsetWidth; wrap.classList.add('pop');
        $('scanPulse').hidden = false;
      }
    }, 2000);
    statusTimer = setInterval(async () => {
      const s = await fetch('/api/whatsapp/status').then((x) => x.json());
      if (s.ready) {
        clearInterval(qrTimer); clearInterval(statusTimer);
        $('qr').hidden = true; $('scanPulse').hidden = true;
        $('waCheck').hidden = false;
        void $('waCheck').offsetWidth; $('waCheck').classList.add('show');
        setStatus('waStatus', 'WhatsApp connected! Go to step 5 when you are ready.');
        $('step5').hidden = false;
        loadLimits();
      }
    }, 3000);
  } catch (e) { setStatus('waStatus', e.message, true); }
  finally { $('btnConnect').disabled = false; }
};
async function loadLimits() {
  if (!campaignId) return;
  const c = await fetch('/api/campaign/' + campaignId).then((x) => x.json());
  $('limitsLine').textContent =
    `Safety: max ${c.limits.daily} messages per 24 hours · random ${c.limits.minDelay}–${c.limits.maxDelay}s delay between messages · each number messaged only once, ever.`;
}

/* --- Step 5: send (animated progress bar, pulsing state, incremental log) --- */
let renderedLines = 0;
function appendLogLines(lines) {
  const box = $('progress');
  for (let i = renderedLines; i < lines.length; i++) {
    const div = document.createElement('div');
    div.className = 'logline';
    div.textContent = lines[i];
    box.appendChild(div);
  }
  while (box.children.length > 120) box.removeChild(box.firstChild); // keep DOM bounded
  renderedLines = lines.length;
  box.scrollTop = box.scrollHeight;
}
function updateSendBar(sent, total, status) {
  $('sendBarWrap').hidden = false;
  const pct = total ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  $('sendBarFill').style.width = pct + '%';
  $('sendBarLabel').textContent = `Sent ${sent} of ${total} · ${pct}%`;
  const st = $('sendState');
  st.hidden = false;
  if (status === 'sending') {
    $('sendStateText').textContent = 'Sending… (waiting between messages to stay safe)';
    st.className = 'sendstate active';
  } else if (status === 'done') {
    $('sendStateText').textContent = 'All done ✓';
    st.className = 'sendstate done';
  } else {
    $('sendStateText').textContent = 'Paused';
    st.className = 'sendstate';
  }
}
function pollProgress() {
  clearInterval(pollTimer);
  renderedLines = 0;
  $('progress').innerHTML = '';
  pollTimer = setInterval(async () => {
    try {
      const c = await fetch('/api/campaign/' + campaignId).then((x) => x.json());
      appendLogLines(c.progress);
      updateSendBar(c.sentCount, c.leads.length, c.status);
      if (c.status === 'done' || c.status === 'stopped') {
        clearInterval(pollTimer);
        $('btnSend').disabled = false; $('btnStop').disabled = true;
      }
    } catch (e) { /* transient — next poll retries */ }
  }, 2500);
}
$('btnSend').onclick = async () => {
  if (!confirm(`Send your pitch to ${finalLeads.length} businesses? You can stop anytime.`)) return;
  $('btnSend').disabled = true; $('btnStop').disabled = false;
  try { await post('/api/send/start', { campaignId }); pollProgress(); }
  catch (e) { alert(e.message); $('btnSend').disabled = false; $('btnStop').disabled = true; }
};
$('btnStop').onclick = async () => {
  await post('/api/send/stop', { campaignId });
  $('btnStop').disabled = true;
};
$('btnCsv').onclick = () => {
  if (campaignId) window.location = '/api/export/' + campaignId;
};
