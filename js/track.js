// Trasa: trackování pohybu + nachozené metry. Záznam se průběžně sám zálohuje (přežije pád/zavření).
'use strict';
import { Store } from './store.js';
import { $, $$, toast, escapeHtml, authorChip, userColor, fmtDistance, fmtDuration, fmtDateTime, confirmSheet, emptyState, getUser } from './ui.js';

const DRAFT_KEY = 'ochr.track.draft.v1';
const FILTER_KEY = 'ochr.track.filter';

let tmap = null;
let liveLine = null;
let recording = false;
let watchId = null;
let points = [];
let distance = 0;
let startTs = 0;
let tick = null;
let lastFix = null;
let filterMine = false;
try {
  filterMine = localStorage.getItem(FILTER_KEY) === 'mine';
} catch {
  /* ignore */
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ points, distance, startTs, lastTs: Date.now() }));
  } catch {
    /* ignore */
  }
}
// Při uspání/zavření stránky stihneme uložit poslední stav (pojistka navíc).
const persistIfRecording = () => {
  if (recording) saveDraft();
};
document.addEventListener('visibilitychange', persistIfRecording);
window.addEventListener('pagehide', persistIfRecording);
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function ensureMap() {
  if (tmap) return;
  tmap = L.map('track-map', { zoomControl: false, attributionControl: false });
  tmap.setView([49.9303, 16.5406], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }).addTo(tmap);
  liveLine = L.polyline([], { color: '#1e88e5', weight: 5 }).addTo(tmap);
}

function updateLive() {
  $('#trk-live-dist').textContent = fmtDistance(distance);
  $('#trk-live-time').textContent = fmtDuration((Date.now() - startTs) / 1000);
}

function onPos(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  if (accuracy && accuracy > 40) return;
  const p = [latitude, longitude];
  if (lastFix) {
    const d = haversine(lastFix, p);
    if (d < 2) return;
    distance += d;
  }
  lastFix = p;
  points.push([Math.round(latitude * 1e5) / 1e5, Math.round(longitude * 1e5) / 1e5]);
  liveLine.addLatLng(p);
  tmap.setView(p, Math.max(tmap.getZoom(), 16));
  updateLive();
  saveDraft(); // průběžné automatické zálohování
}

function startRecording() {
  if (!('geolocation' in navigator)) {
    toast('Tvé zařízení nepodporuje GPS', { error: true });
    return;
  }
  recording = true;
  points = [];
  distance = 0;
  lastFix = null;
  startTs = Date.now();
  liveLine.setLatLngs([]);
  saveDraft(); // hned od začátku zapiš draft (ať máme startTs i při brzkém zavření)
  const btn = $('#trk-toggle');
  btn.innerHTML = '<span class="rec-dot"></span> Ukončit a uložit';
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-danger');
  toast('Záznam trasy spuštěn 🥾');
  watchId = navigator.geolocation.watchPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  tick = setInterval(() => {
    updateLive();
    saveDraft();
  }, 1000);
}

async function persistTrack(pts, dist, started, ended, note) {
  await Store.add('tracks', {
    label: (note || '').trim().slice(0, 80),
    points: pts,
    distance: Math.round(dist),
    duration: Math.round((ended - started) / 1000),
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
  });
}

async function stopRecording() {
  recording = false;
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (tick) clearInterval(tick);
  const btn = $('#trk-toggle');
  btn.innerHTML = '▶ Začít záznam';
  btn.classList.add('btn-primary');
  btn.classList.remove('btn-danger');

  const endTs = Date.now();
  if (points.length < 2 || distance < 5) {
    toast('Trasa je moc krátká, neukládám');
    distance = 0;
    clearDraft();
    updateLive();
    return;
  }
  await persistTrack(points, distance, startTs, endTs, '');
  clearDraft();
  toast(`Trasa uložena ✓ ${fmtDistance(distance)}`);
}

// Po pádu/zavření appky obnoví rozdělanou trasu a sama ji uloží.
// Volá se HNED po startu appky (na kterékoli záložce), ne až při otevření Trasy.
let recovered = false;
export async function recoverTrackDraft() {
  if (recovered || recording) return;
  recovered = true;
  let d = null;
  try {
    d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  } catch {
    d = null;
  }
  if (!d || !Array.isArray(d.points) || d.points.length < 2) {
    clearDraft();
    return;
  }
  // Vzdálenost dopočítáme z bodů, kdyby v draftu chyběla nebo byla nulová.
  let dist = Number(d.distance) || 0;
  if (dist < 1) {
    for (let i = 1; i < d.points.length; i++) dist += haversine(d.points[i - 1], d.points[i]);
  }
  const started = d.startTs || Date.now();
  const ended = d.lastTs || started;
  await persistTrack(d.points, dist, started, ended, 'Obnovená trasa');
  clearDraft();
  toast(`Nedokončená trasa obnovena a uložena ✓ ${fmtDistance(dist)}`, { ms: 4000 });
}

function setFilter(mine) {
  filterMine = mine;
  try {
    localStorage.setItem(FILTER_KEY, mine ? 'mine' : 'all');
  } catch {
    /* ignore */
  }
  $$('#view-track .seg button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === mine));
  renderList(Store.get('tracks'));
}

function renderList(items) {
  const me = getUser()?.name;
  const total = items.reduce((s, t) => s + (t.distance || 0), 0);
  const mineTotal = items.filter((t) => t.author === me).reduce((s, t) => s + (t.distance || 0), 0);
  if ($('#trk-total-dist')) $('#trk-total-dist').textContent = fmtDistance(total);
  if ($('#trk-mine-dist')) $('#trk-mine-dist').textContent = fmtDistance(mineTotal);

  const list = $('#trk-list');
  if (!list) return;
  const shown = filterMine ? items.filter((t) => t.author === me) : items;
  if (!shown.length) {
    list.innerHTML = emptyState('🥾', 'Zatím žádné trasy. Klepni na „Začít záznam“ a vyraz do terénu.');
    return;
  }
  list.innerHTML = shown
    .map(
      (t) => `
    <div class="card" style="border-left:4px solid ${userColor(t.author)}">
      <div class="row between">
        <h3>${escapeHtml(t.label || 'Trasa')} ${t._pending ? '<span class="pend">⏳</span>' : ''}</h3>
        <span class="num water" style="font-size:20px;font-weight:800">${escapeHtml(fmtDistance(t.distance))}</span>
      </div>
      <div class="meta">
        <span>⏱️ ${escapeHtml(fmtDuration(t.duration))}</span>
        ${authorChip(t.author)}
        <span>${escapeHtml(fmtDateTime(t.startedAt))}</span>
        <span class="spacer"></span>
        <button class="btn-ghost" data-del="${t.id}" type="button" style="min-height:32px;padding:0 12px">Smazat</button>
      </div>
    </div>`
    )
    .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tuto trasu?', { okText: 'Smazat', danger: true }))) return;
      await Store.remove('tracks', b.dataset.del);
      toast('Smazáno');
    };
  });
}

export const TrackView = {
  collections: ['tracks'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Trasa</h2><div class="sub">Záznam pohybu a nachozené metry</div></div></div>
      <div class="stat-grid">
        <div class="stat"><div class="num water" id="trk-total-dist">0 m</div><div class="lbl">Tým celkem</div></div>
        <div class="stat"><div class="num" id="trk-mine-dist">0 m</div><div class="lbl">Moje</div></div>
      </div>
      <div class="card">
        <div id="track-map" style="height:200px;border-radius:10px;overflow:hidden;background:#dde"></div>
        <div class="row between" style="margin-top:12px">
          <div><div class="num water" id="trk-live-dist" style="font-size:30px">0 m</div><div class="lbl">vzdálenost</div></div>
          <div style="text-align:right"><div id="trk-live-time" style="font-size:24px;font-weight:800;color:var(--green)">0:00</div><div class="lbl">čas</div></div>
        </div>
        <button id="trk-toggle" class="btn-primary" style="width:100%;margin-top:12px">▶ Začít záznam</button>
        <p class="login-foot" style="text-align:left">Trasa se během nahrávání průběžně sama zálohuje. I když appku zavřeš nebo spadne, po dalším spuštění se rozdělaná trasa sama obnoví a uloží. Po ukončení se sečte do nachozených metrů týmu.</p>
      </div>
      <div class="seg" style="margin-top:4px">
        <button data-f="all" class="active" type="button">👥 Vše</button>
        <button data-f="mine" type="button">🙋 Moje</button>
      </div>
      <div class="list-divider">Uložené trasy</div>
      <div id="trk-list"></div>`;
    ensureMap();
    $$('#view-track .seg button').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.f === 'mine')));
    $$('#view-track .seg button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === filterMine));
    $('#trk-toggle').addEventListener('click', () => (recording ? stopRecording() : startRecording()));
    Store.subscribe('tracks', renderList);
  },
  onShow() {
    if (tmap) setTimeout(() => tmap.invalidateSize(), 80);
  },
  onHide() {
    if (recording) toast('Záznam trasy stále běží 🥾');
  },
};
