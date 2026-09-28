'use strict';

/* ---------- helpers ---------- */

const $ = (id) => document.getElementById(id);
const audio = $('audio');

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M18 6l-8.5 6 8.5 6zM6 6h2v12H6z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg>',
  repeatOne: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/><path d="M11.2 10.5h1.6v5h-1.4v-3.4l-.9.3v-1.1z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  local: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 14.5-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M19.4 10A7.5 7.5 0 0 0 5.4 8 6 6 0 0 0 6 20h13a5 5 0 0 0 .4-10z"/></svg>',
  saving: '<svg viewBox="0 0 24 24"><path d="M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM5 19h14v2H5z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z"/></svg>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function fmtBytes(n) {
  if (!n) return '0 MB';
  return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`;
}

const extractUrl = (text) => (String(text || '').match(/https?:\/\/[^\s<>"']+/) || [null])[0];

const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('bt:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('bt:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ---------- IndexedDB: saved songs live here ---------- */

const db = (() => {
  let opening;
  const open = () => opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('berrytunes', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('tracks', { keyPath: 'id' }); // metadata of songs saved on this device
      req.result.createObjectStore('files');                     // "<id>:audio" / "<id>:cover" -> Blob
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function run(store, mode, fn) {
    const conn = await open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  return {
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: (store, value, key) => run(store, 'readwrite', (s) => s.put(value, key)),
    del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  };
})();

/* ---------- state ---------- */

const state = {
  online: null,
  ytdlp: null,
  server: new Map(),   // id -> track on the PC
  local: new Map(),    // id -> track saved on this device
  saving: new Set(),
  jobs: [],
  baseQueue: [],
  queue: [],
  qi: -1,
  current: null,
  filter: '',
  shuffle: prefs.get('shuffle', false),
  repeat: prefs.get('repeat', 'off'), // off | all | one
  autosave: prefs.get('autosave', true),
  pendingAdds: prefs.get('pendingAdds', []),
  pendingDeletes: prefs.get('pendingDeletes', []),
  dismissed: new Set(prefs.get('dismissedJobs', [])),
};

const coverUrls = new Map(); // id -> blob: URL for locally saved covers
let audioUrl = null;

const trackById = (id) => state.server.get(id) || state.local.get(id);

function allTracks() {
  const merged = new Map(state.local);
  for (const [id, t] of state.server) merged.set(id, t);
  return [...merged.values()].sort((a, b) => b.added_at - a.added_at);
}

function visibleTracks() {
  const q = state.filter.trim().toLowerCase();
  const list = allTracks();
  return q ? list.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q)) : list;
}

const isPlayable = (id) => state.local.has(id) || (state.online && state.server.has(id));

function coverUrl(t) {
  if (coverUrls.has(t.id)) return coverUrls.get(t.id);
  if (state.online && t.has_cover && state.server.has(t.id)) return `/api/tracks/${t.id}/cover`;
  return '';
}

/* ---------- server API ---------- */

class ApiError extends Error {}

async function api(path, opts = {}, timeout = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch('/api' + path, { ...opts, signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch { /* not JSON */ }
      throw new ApiError(msg);
    }
    return res;
  } catch (e) {
    if (!(e instanceof ApiError)) setOnline(false);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function setOnline(online) {
  if (state.online === online) return;
  state.online = online;
  const el = $('status');
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
  $('status-text').textContent = online ? 'PC online' : 'PC offline';
  renderTracks();
}

async function checkHealth() {
  try {
    const info = await (await api('/health', {}, 4000)).json();
    state.ytdlp = info.yt_dlp;
    setOnline(true);
    return true;
  } catch {
    return false;
  }
}

async function refreshTracks() {
  const tracks = await (await api('/tracks')).json();
  state.server = new Map(tracks.map((t) => [t.id, t]));
  renderTracks();
}

/* ---------- adding songs ---------- */

async function addUrl(raw) {
  const url = extractUrl(raw);
  if (!url) { toast("That doesn't look like a link."); return; }
  try {
    await api('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    pollJobs();
  } catch (e) {
    if (e instanceof ApiError) { toast(e.message); return; }
    state.pendingAdds.push(url);
    prefs.set('pendingAdds', state.pendingAdds);
    toast('PC is offline. The link will be sent when it’s back.');
  }
  renderJobs();
}

async function flushPending() {
  while (state.pendingDeletes.length) {
    await api(`/tracks/${state.pendingDeletes[0]}`, { method: 'DELETE' });
    state.pendingDeletes.shift();
    prefs.set('pendingDeletes', state.pendingDeletes);
  }
  while (state.pendingAdds.length) {
    await api('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: state.pendingAdds[0] }) });
    state.pendingAdds.shift();
    prefs.set('pendingAdds', state.pendingAdds);
  }
}

let pollTimer = null;
async function pollJobs() {
  clearTimeout(pollTimer);
  try {
    state.jobs = await (await api('/jobs')).json();
  } catch {
    return;
  }
  if (state.jobs.some((j) => j.status === 'done' && j.track_id && !state.server.has(j.track_id))) {
    await refreshTracks().catch(() => {});
    if (state.autosave) saveMissing();
  }
  renderJobs();
  if (state.jobs.some((j) => ['queued', 'downloading', 'processing'].includes(j.status))) {
    pollTimer = setTimeout(pollJobs, 1500);
  }
}

function dismissJob(id) {
  state.dismissed.add(id);
  prefs.set('dismissedJobs', [...state.dismissed].slice(-100));
  renderJobs();
}

function renderJobs() {
  const now = Date.now() / 1000;
  // Playlist summaries stay up a little longer so there's time to read them.
  const showDone = (j) => j.finished_at >= now - (j.kind === 'playlist' ? 20 : 8);
  const items = state.pendingAdds.map((url) => `
    <li class="job"><div class="label"><strong>${esc(url)}</strong><small>Waiting for your PC to come online</small></div></li>`);
  const dismiss = (j) => `<button type="button" data-dismiss="${j.id}" aria-label="Dismiss">${ICONS.close}</button>`;
  const row = (j, label, extra = '') => `<li class="job${j.status === 'error' ? ' error' : ''}">
    <div class="label"><strong>${esc(j.title || j.url)}</strong><small>${esc(label)}</small></div>${extra}</li>`;

  // Oldest first, so the song downloading now sits above the ones waiting behind it.
  const jobs = state.jobs.filter((j) => !state.dismissed.has(j.id)).reverse();
  for (const j of jobs) {
    if (j.status === 'downloading' || j.status === 'processing') {
      const label = j.kind === 'playlist' ? 'Reading playlist…'
        : j.status === 'processing' ? 'Converting…' : `Downloading… ${Math.round(j.progress * 100)}%`;
      items.push(row(j, label, `<span class="bar" style="width:${Math.round(j.progress * 100)}%"></span>`));
    }
  }
  const queued = jobs.filter((j) => j.status === 'queued');
  if (queued.length === 1) {
    items.push(row(queued[0], 'Queued'));
  } else if (queued.length > 1) {
    items.push(`<li class="job"><div class="label"><strong>${queued.length} songs waiting</strong>
      <small>Next: ${esc(queued[0].title || queued[0].url)}</small></div>
      <button type="button" class="text-btn" data-cancel-queued>Cancel</button></li>`);
  }
  for (const j of jobs) {
    if (j.status === 'error') {
      items.push(row(j, j.error, dismiss(j)));
    } else if (j.status === 'done' && showDone(j)) {
      let label = j.duplicate ? 'Already in your library' : 'Added to your library';
      if (j.playlist) {
        const { added, already } = j.playlist;
        label = `Playlist: ${added} song${added === 1 ? '' : 's'} queued` + (already ? ` · ${already} already in your library` : '');
      }
      items.push(row(j, label, dismiss(j)));
    }
  }
  $('jobs').innerHTML = items.join('');
  clearTimeout(renderJobs.timer);
  if (state.jobs.some((j) => j.status === 'done' && showDone(j))) renderJobs.timer = setTimeout(renderJobs, 2000);
}

async function cancelQueued() {
  const count = state.jobs.filter((j) => j.status === 'queued').length;
  if (!confirm(`Cancel ${count} waiting songs? The one downloading now will finish.`)) return;
  try {
    await api('/jobs/queued', { method: 'DELETE' });
  } catch {
    toast('Couldn’t reach your PC.');
  }
  pollJobs();
}

/* ---------- saving songs to this device ---------- */

async function loadLocal() {
  for (const t of await db.all('tracks')) {
    state.local.set(t.id, t);
    if (t.has_cover) {
      const blob = await db.get('files', `${t.id}:cover`);
      if (blob) coverUrls.set(t.id, URL.createObjectURL(blob));
    }
  }
}

async function saveTrack(id) {
  const t = state.server.get(id);
  if (!t || state.local.has(id) || state.saving.has(id)) return;
  state.saving.add(id);
  renderTracks();
  try {
    const audioBlob = await (await api(`/tracks/${id}/audio`, {}, 10 * 60 * 1000)).blob();
    let coverBlob = null;
    if (t.has_cover) coverBlob = await (await api(`/tracks/${id}/cover`)).blob().catch(() => null);
    await db.put('files', audioBlob, `${id}:audio`);
    if (coverBlob) {
      await db.put('files', coverBlob, `${id}:cover`);
      coverUrls.set(id, URL.createObjectURL(coverBlob));
    }
    const meta = { ...t, has_cover: !!coverBlob };
    await db.put('tracks', meta);
    state.local.set(id, meta);
    navigator.storage?.persist?.().catch(() => {});
  } catch (e) {
    if (e?.name === 'QuotaExceededError') toast('This device is out of space for more songs.');
  } finally {
    state.saving.delete(id);
    renderTracks();
  }
}

let savingAll = false;
async function saveMissing() {
  if (savingAll) return;
  savingAll = true;
  try {
    for (const id of state.server.keys()) {
      if (!state.online) break;
      await saveTrack(id);
    }
  } finally {
    savingAll = false;
  }
}

async function removeLocal(id) {
  await db.del('tracks', id);
  await db.del('files', `${id}:audio`);
  await db.del('files', `${id}:cover`);
  state.local.delete(id);
  if (coverUrls.has(id)) {
    URL.revokeObjectURL(coverUrls.get(id));
    coverUrls.delete(id);
  }
}

async function deleteTrack(id) {
  const t = trackById(id);
  if (!t || !confirm(`Delete “${t.title}” from your library?`)) return;
  if (state.current === id) {
    audio.pause();
    audio.removeAttribute('src');
    state.current = null;
    renderNowPlaying();
  }
  if (state.server.has(id)) {
    try {
      await api(`/tracks/${id}`, { method: 'DELETE' });
    } catch {
      state.pendingDeletes.push(id);
      prefs.set('pendingDeletes', state.pendingDeletes);
    }
    state.server.delete(id);
  }
  await removeLocal(id);
  renderTracks();
}

/* ---------- track list ---------- */

function renderTracks() {
  const list = visibleTracks();
  $('empty').hidden = allTracks().length > 0;
  $('tracks').innerHTML = list.map((t) => {
    const cover = coverUrl(t);
    const [cls, icon, label] = state.local.has(t.id) ? ['local', ICONS.local, 'Saved on this device']
      : state.saving.has(t.id) ? ['saving', ICONS.saving, 'Saving to this device']
      : ['', ICONS.cloud, 'On your PC only'];
    const sub = [t.artist, fmtTime(t.duration)].filter(Boolean).join(' · ');
    return `<li class="track${t.id === state.current ? ' playing' : ''}${isPlayable(t.id) ? '' : ' unavailable'}" data-id="${t.id}">
      <button class="main" type="button">
        <span class="cover"><img alt="" ${cover ? `src="${esc(cover)}"` : ''} onerror="this.removeAttribute('src')"></span>
        <span class="meta"><strong>${esc(t.title)}</strong><small>${esc(sub)}</small></span>
      </button>
      <span class="state ${cls}" title="${label}" aria-label="${label}">${icon}</span>
      <button class="icon-btn more" type="button" aria-label="More">${ICONS.more}</button>
    </li>`;
  }).join('');
}

$('tracks').addEventListener('click', (e) => {
  const li = e.target.closest('.track');
  if (!li) return;
  const id = li.dataset.id;
  if (e.target.closest('.more')) { openTrackSheet(id); return; }
  if (!isPlayable(id)) { toast('This song isn’t saved here and your PC is offline.'); return; }
  playFromList(id);
});

$('jobs').addEventListener('click', (e) => {
  if (e.target.closest('[data-cancel-queued]')) { cancelQueued(); return; }
  const btn = e.target.closest('[data-dismiss]');
  if (btn) dismissJob(btn.dataset.dismiss);
});

$('search').addEventListener('input', (e) => { state.filter = e.target.value; renderTracks(); });

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('add-url');
  const btn = e.submitter || e.target.querySelector('button');
  btn.disabled = true;
  await addUrl(input.value);
  btn.disabled = false;
  input.value = '';
  input.blur();
});

/* ---------- playback ---------- */

function shuffled(ids, firstId) {
  const rest = ids.filter((id) => id !== firstId);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return firstId ? [firstId, ...rest] : rest;
}

function playFromList(id) {
  state.baseQueue = visibleTracks().map((t) => t.id);
  state.queue = state.shuffle ? shuffled(state.baseQueue, id) : state.baseQueue.slice();
  state.qi = state.queue.indexOf(id);
  playCurrent();
}

async function playCurrent() {
  const id = state.queue[state.qi];
  const t = trackById(id);
  if (!t) return;
  let src = null;
  if (state.local.has(id)) {
    const blob = await db.get('files', `${id}:audio`);
    if (blob) src = URL.createObjectURL(blob);
    else await removeLocal(id); // iOS evicted it; fall back to the PC copy
  }
  if (!src) {
    if (!state.online || !state.server.has(id)) { toast('That song isn’t available offline.'); return; }
    src = `/api/tracks/${id}/audio`;
  }
  if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
  audioUrl = src;
  audio.src = src;
  state.current = id;
  renderNowPlaying();
  renderTracks();
  updateMediaSession(t);
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== 'AbortError') renderPlayState(); // autoplay blocked: user taps play
  }
}

function step(dir, auto = false) {
  if (!state.queue.length) return;
  if (auto && state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  if (dir < 0 && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const n = state.queue.length;
  for (let tries = 0; tries < n; tries++) {
    let i = state.qi + dir;
    if (i >= n) {
      if (auto && state.repeat === 'off') { renderPlayState(); return; }
      i = 0;
    }
    if (i < 0) i = n - 1;
    state.qi = i;
    if (isPlayable(state.queue[i])) { playCurrent(); return; }
  }
}

function togglePlay() {
  if (!state.current) {
    const first = visibleTracks().find((t) => isPlayable(t.id));
    if (first) playFromList(first.id);
    return;
  }
  audio.paused ? audio.play() : audio.pause();
}

function renderPlayState() {
  const icon = audio.paused ? ICONS.play : ICONS.pause;
  $('mini-play').innerHTML = icon;
  $('play').innerHTML = icon;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
}

function renderModes() {
  $('shuffle').classList.toggle('on', state.shuffle);
  $('repeat').classList.toggle('on', state.repeat !== 'off');
  $('repeat').innerHTML = state.repeat === 'one' ? ICONS.repeatOne : ICONS.repeat;
}

function renderNowPlaying() {
  const t = state.current && trackById(state.current);
  $('mini').hidden = !t;
  if (!t) { $('player').hidden = true; return; }
  const cover = coverUrl(t);
  for (const img of [$('mini-cover'), $('player-cover')]) {
    if (cover) img.src = cover; else img.removeAttribute('src');
  }
  $('mini-title').textContent = $('player-title').textContent = t.title;
  $('mini-artist').textContent = $('player-artist').textContent = t.artist || '';
  renderPlayState();
}

let seeking = false;
function renderProgress() {
  const d = audio.duration, c = audio.currentTime;
  const frac = d ? c / d : 0;
  $('mini-bar').style.width = `${frac * 100}%`;
  if (!seeking) {
    $('seek').value = Math.round(frac * 1000);
    $('t-cur').textContent = fmtTime(c) || '0:00';
  }
  $('t-dur').textContent = fmtTime(d) || '0:00';
}

async function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  const artwork = [];
  if (t.has_cover) {
    // Lock screen can't read blob: URLs reliably, so hand it a data: URL.
    const blob = state.local.has(t.id)
      ? await db.get('files', `${t.id}:cover`)
      : await api(`/tracks/${t.id}/cover`).then((r) => r.blob()).catch(() => null);
    if (blob) {
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
      if (dataUrl) artwork.push({ src: dataUrl, sizes: '512x512', type: blob.type || 'image/jpeg' });
    }
  }
  if (state.current !== t.id) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: 'BerryTunes', artwork });
}

function updatePositionState() {
  if (!navigator.mediaSession?.setPositionState || !Number.isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate });
  } catch { /* ignore invalid states mid-load */ }
}

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    previoustrack: () => step(-1),
    nexttrack: () => step(1),
    seekto: (d) => { audio.currentTime = d.seekTime; updatePositionState(); },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ }
  }
}

audio.addEventListener('play', renderPlayState);
audio.addEventListener('pause', renderPlayState);
audio.addEventListener('timeupdate', renderProgress);
audio.addEventListener('loadedmetadata', () => { renderProgress(); updatePositionState(); });
audio.addEventListener('seeked', updatePositionState);
audio.addEventListener('ended', () => step(1, true));
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  toast('Couldn’t play that song.');
  renderPlayState();
});

$('mini-play').addEventListener('click', togglePlay);
$('play').addEventListener('click', togglePlay);
$('mini-next').addEventListener('click', () => step(1));
$('next').addEventListener('click', () => step(1));
$('prev').addEventListener('click', () => step(-1));
$('mini-open').addEventListener('click', () => { $('player').hidden = false; });
$('player-close').addEventListener('click', () => { $('player').hidden = true; });

$('shuffle').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  prefs.set('shuffle', state.shuffle);
  if (state.queue.length) {
    state.queue = state.shuffle ? shuffled(state.baseQueue, state.current) : state.baseQueue.slice();
    state.qi = Math.max(0, state.queue.indexOf(state.current));
  }
  renderModes();
});

$('repeat').addEventListener('click', () => {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  prefs.set('repeat', state.repeat);
  renderModes();
});

$('seek').addEventListener('input', (e) => {
  seeking = true;
  $('t-cur').textContent = fmtTime((e.target.value / 1000) * (audio.duration || 0)) || '0:00';
});
$('seek').addEventListener('change', (e) => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (e.target.value / 1000) * audio.duration;
  seeking = false;
});

/* ---------- sheets ---------- */

let sheetTrack = null;

function openSheet(el) {
  $('sheet-backdrop').hidden = false;
  el.hidden = false;
}

function closeSheets() {
  $('sheet-backdrop').hidden = true;
  $('track-sheet').hidden = true;
  $('settings-sheet').hidden = true;
}

function openTrackSheet(id) {
  const t = trackById(id);
  if (!t) return;
  sheetTrack = id;
  $('sheet-title').textContent = t.title;
  const where = state.local.has(id) ? 'Saved on this device' : 'On your PC only';
  $('sheet-sub').textContent = [t.artist, where, t.size && fmtBytes(t.size)].filter(Boolean).join(' · ');
  $('sheet-save').hidden = state.local.has(id) || !state.online || !state.server.has(id);
  $('sheet-source').hidden = !t.source_url;
  openSheet($('track-sheet'));
}

$('sheet-save').addEventListener('click', () => { closeSheets(); saveTrack(sheetTrack); });
$('sheet-source').addEventListener('click', () => {
  const t = trackById(sheetTrack);
  closeSheets();
  if (t?.source_url) window.open(t.source_url, '_blank', 'noopener');
});
$('sheet-delete').addEventListener('click', () => { closeSheets(); deleteTrack(sheetTrack); });

async function openSettings() {
  $('autosave').checked = state.autosave;
  $('ytdlp').textContent = state.ytdlp || '–';
  $('storage').textContent = '…';
  openSheet($('settings-sheet'));
  let used = 0;
  for (const t of state.local.values()) used += t.size || 0;
  $('storage').textContent = `${fmtBytes(used)} · ${state.local.size} songs`;
}

$('open-settings').addEventListener('click', openSettings);
$('autosave').addEventListener('change', (e) => {
  state.autosave = e.target.checked;
  prefs.set('autosave', state.autosave);
  if (state.autosave && state.online) saveMissing();
});
$('save-all').addEventListener('click', () => {
  closeSheets();
  if (!state.online) { toast('Your PC is offline.'); return; }
  saveMissing();
});
$('sheet-backdrop').addEventListener('click', closeSheets);
document.querySelectorAll('.sheet-cancel').forEach((b) => b.addEventListener('click', closeSheets));
$('status').addEventListener('click', () => {
  toast(state.online ? 'Connected to your PC.' : 'Can’t reach your PC. Check it’s on and Tailscale is connected.');
  sync();
});

/* ---------- sync loop ---------- */

let syncing = false;
async function sync() {
  if (syncing) return;
  syncing = true;
  try {
    if (!(await checkHealth())) return;
    await flushPending();
    await refreshTracks();
    await pollJobs();
    if (state.autosave) saveMissing();
  } catch {
    /* went offline mid-sync; next tick retries */
  } finally {
    syncing = false;
    renderJobs();
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('online', sync);
setInterval(() => { if (!document.hidden) sync(); }, 30000);

/* ---------- boot ---------- */

async function boot() {
  $('prev').innerHTML = ICONS.prev;
  $('next').innerHTML = ICONS.next;
  $('mini-next').innerHTML = ICONS.next;
  $('shuffle').innerHTML = ICONS.shuffle;
  renderModes();
  renderPlayState();

  try { await loadLocal(); } catch { toast('Couldn’t open saved songs on this device.'); }
  renderTracks();
  renderJobs();

  // Links arriving from the iOS Shortcut: /?add=<url>
  const params = new URLSearchParams(location.search);
  const shared = params.get('add') || params.get('url') || params.get('text');
  if (shared) {
    history.replaceState(null, '', location.pathname);
    await sync();
    await addUrl(shared);
  } else {
    sync();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
