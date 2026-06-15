// Trasa: volitelné trackování pohybu a počítání nachozených metrů.
'use strict';
import { Store } from './store.js';
import { $, toast, escapeHtml, fmtDistance, fmtDuration, fmtDateTime, confirmSheet, emptyState } from './ui.js';

let tmap = null;
let liveLine = null;
let recording = false;
let watchId = null;
let points = []; // [lat, lng]
let distance = 0; // m
let startTs = 0;
let tick = null;
let lastFix = null;

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ensureMap() {
  if (tmap) return;
  tmap = L.map('track-map', { zoomControl: false, attributionControl: false });
  tmap.setView([49.927, 16.535], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }).addTo(tmap);
  liveLine = L.polyline([], { color: '#1e88e5', weight: 5 }).addTo(tmap);
}

function updateLive() {
  $('#trk-live-dist').textContent = fmtDistance(distance);
  $('#trk-live-time').textContent = fmtDuration((Date.now() - startTs) / 1000);
}

function onPos(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  if (accuracy && accuracy > 40) return; // ignoruj nepřesné fixy
  const p = [latitude, longitude];
  if (lastFix) {
    const d = haversine(lastFix, p);
    if (d < 2) return; // ignoruj mikropohyb / GPS šum
    distance += d;
  }
  lastFix = p;
  points.push([Math.round(latitude * 1e5) / 1e5, Math.round(longitude * 1e5) / 1e5]);
  liveLine.addLatLng(p);
  tmap.setView(p, Math.max(tmap.getZoom(), 16));
  updateLive();
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
  const btn = $('#trk-toggle');
  btn.innerHTML = '<span class="rec-dot"></span> Ukončit a uložit';
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-danger');
  toast('Záznam trasy spuštěn 🥾');
  watchId = navigator.geolocation.watchPosition(onPos, () => {}, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000,
  });
  tick = setInterval(updateLive, 1000);
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

  const durSec = Math.round((Date.now() - startTs) / 1000);
  if (points.length < 2 || distance < 5) {
    toast('Trasa je moc krátká, neukládám');
    distance = 0;
    updateLive();
    return;
  }
  const label = prompt('Název trasy (nepovinné):', '') || '';
  try {
    await Store.add('tracks', {
      label: label.trim().slice(0, 80),
      points,
      distance: Math.round(distance),
      duration: durSec,
      startedAt: new Date(startTs).toISOString(),
      endedAt: new Date().toISOString(),
    });
    toast(`Trasa uložena ✓ ${fmtDistance(distance)}`);
  } catch {
    toast('Uložení trasy selhalo', { error: true });
  }
}

function renderList(items) {
  const total = items.reduce((s, t) => s + (t.distance || 0), 0);
  if ($('#trk-total-dist')) $('#trk-total-dist').textContent = fmtDistance(total);
  if ($('#trk-count')) $('#trk-count').textContent = items.length;
  const list = $('#trk-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = emptyState('🥾', 'Zatím žádné trasy. Klepni na „Začít záznam“ a vyraz do terénu.');
    return;
  }
  list.innerHTML = items
    .map(
      (t) => `
    <div class="card" data-id="${t.id}">
      <div class="row between">
        <h3>${escapeHtml(t.label || 'Trasa')}</h3>
        <span class="num water" style="font-size:20px;font-weight:800">${escapeHtml(fmtDistance(t.distance))}</span>
      </div>
      <div class="meta">
        <span>⏱️ ${escapeHtml(fmtDuration(t.duration))}</span>
        <span class="pill author">${escapeHtml(t.author || '?')}</span>
        <span>${escapeHtml(fmtDateTime(t.startedAt))}</span>
      </div>
      <div class="sheet-buttons" style="margin-top:10px">
        <button class="danger" data-del="${t.id}" type="button">Smazat</button>
      </div>
    </div>`
    )
    .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tuto trasu?', { okText: 'Smazat', danger: true }))) return;
      try {
        await Store.remove('tracks', b.dataset.del);
        toast('Smazáno');
      } catch {
        toast('Smazání selhalo', { error: true });
      }
    };
  });
}

export const TrackView = {
  collections: ['tracks'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Trasa</h2><div class="sub">Záznam pohybu a nachozené metry</div></div></div>
      <div class="stat-grid">
        <div class="stat"><div class="num water" id="trk-total-dist">0 m</div><div class="lbl">Nachozeno celkem</div></div>
        <div class="stat"><div class="num" id="trk-count">0</div><div class="lbl">Tras</div></div>
      </div>
      <div class="card">
        <div id="track-map" style="height:200px;border-radius:10px;overflow:hidden;background:#dde"></div>
        <div class="row between" style="margin-top:12px">
          <div><div class="num water" id="trk-live-dist" style="font-size:30px">0 m</div><div class="lbl">vzdálenost</div></div>
          <div style="text-align:right"><div id="trk-live-time" style="font-size:24px;font-weight:800;color:var(--green)">0:00</div><div class="lbl">čas</div></div>
        </div>
        <button id="trk-toggle" class="btn-primary" style="width:100%;margin-top:12px">▶ Začít záznam</button>
        <p class="login-foot" style="text-align:left">Nech aplikaci otevřenou a telefon odemčený, ať GPS běží. Trasa se po ukončení uloží a sečte do nachozených metrů týmu.</p>
      </div>
      <div class="list-divider">Uložené trasy</div>
      <div id="trk-list"></div>`;
    ensureMap();
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
