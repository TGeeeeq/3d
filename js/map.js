// Mapa: sdílené body a plochy. Region = 20 km okruh kolem Ostrova (max dosah lokalit).
// Potok s meandry = Rudoltička (u Rudoltic / Ostrova). Volba kategorie + barva autora.
'use strict';
import { Store } from './store.js';
import {
  $, toast, openSheet, openOverlay, closeOverlay, escapeHtml, fmtDateTime, confirmSheet, getUser, userColor,
} from './ui.js';
import { localityOptionsHtml, localityName } from './localities-data.js';

// Ostrov u Lanškrouna – střed oblasti, kde tým pečuje o lokality.
const OSTROV = [49.930273, 16.540589];
const PERIMETER_RADIUS = 20000; // 20 km
const BASEMAP_KEY = 'ochr.basemap.v1';
const FILTER_KEY = 'ochr.map.filter';

// Kategorie pro rychlý zápis v terénu (volba u špendlíku i plochy).
export const CATS = {
  problem: { name: 'Problém / zásah', icon: '🪲', color: '#e53935' },
  observation: { name: 'Pozorování', icon: '🌿', color: '#43a047' },
  pchac: { name: 'Pcháč', icon: '🌵', color: '#8e24aa' },
  stovik: { name: 'Šťovík', icon: '🌾', color: '#6d4c41' },
  kostival: { name: 'Kostival lékařský', icon: '🌸', color: '#5e35b1' },
  hermanek: { name: 'Heřmánek', icon: '🌼', color: '#fbc02d' },
  ohrazenka: { name: 'Ohrazenka', icon: '🚧', color: '#fb8c00' },
  jezirko: { name: 'Jezírko', icon: '💧', color: '#1e88e5' },
  vysadba: { name: 'Výsadba', icon: '🌱', color: '#2e7d32' },
  most: { name: 'Most / lávka', icon: '🌉', color: '#455a64' },
  meandr: { name: 'Meandr', icon: '🌊', color: '#00838f' },
  pastva: { name: 'Pastva / kravky', icon: '🐄', color: '#a1887f' },
};
const catOf = (c) => CATS[c] || CATS.observation;

let map = null;
let notesLayer = null;
let perimeter = null;
const rendered = new Map(); // id -> { layer, sig }
let addPointMode = false;
let shapeEditFeature = null;
let locating = false;
let lastPosition = null;
let locateDot = null;
let locateCircle = null;
let firstFix = false;
let btnFinishShape = null;
let filterMine = false;
try {
  filterMine = localStorage.getItem(FILTER_KEY) === 'mine';
} catch {
  /* ignore */
}

function pinIcon(cat, author) {
  const c = catOf(cat);
  const ring = userColor(author);
  return L.divIcon({
    className: '',
    html: `<span class="note-pin" style="background:${c.color};box-shadow:0 0 0 3px ${ring},0 1px 4px rgba(0,0,0,.5)"><span class="pin-ic">${c.icon}</span></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 24],
  });
}
const polygonStyle = (color, author) => ({
  color: userColor(author),
  weight: 3,
  fillColor: color,
  fillOpacity: 0.25,
});

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true });
  map.setView(OSTROV, 14);

  const baseLayers = {
    'Letecká ČÚZK (CZ ortofoto)': L.tileLayer(
      'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 20, maxZoom: 21, attribution: '© ČÚZK – ortofoto ČR' }
    ),
    'Letecká Esri (HD)': L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 19, maxZoom: 21, attribution: '© Esri World Imagery' }
    ),
    'Obyčejná mapa': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }),
  };
  let saved = null;
  try {
    saved = localStorage.getItem(BASEMAP_KEY);
  } catch {
    /* ignore */
  }
  (baseLayers[saved] || baseLayers['Letecká ČÚZK (CZ ortofoto)']).addTo(map);
  L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', (e) => {
    try {
      localStorage.setItem(BASEMAP_KEY, e.name);
    } catch {
      /* ignore */
    }
  });

  // perimetr 20 km kolem Ostrova
  perimeter = L.circle(OSTROV, {
    radius: PERIMETER_RADIUS,
    color: '#1e3a2f',
    weight: 2,
    dashArray: '8,6',
    fill: false,
    interactive: false,
  }).addTo(map);

  notesLayer = L.layerGroup().addTo(map);

  btnFinishShape = document.createElement('button');
  btnFinishShape.type = 'button';
  btnFinishShape.className = 'tool-btn';
  btnFinishShape.textContent = '✓ Hotovo';
  btnFinishShape.style.cssText =
    'position:absolute;left:50%;transform:translateX(-50%);bottom:64px;z-index:1001;' +
    'min-width:150px;background:#1e3a2f;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4);';
  btnFinishShape.hidden = true;
  $('#view-map').appendChild(btnFinishShape);
  btnFinishShape.addEventListener('click', finishShapeEdit);

  // filtr Vše / Jen moje
  const filterBar = document.createElement('div');
  filterBar.id = 'map-filter';
  filterBar.innerHTML = `
    <button data-f="all" type="button">👥 Vše</button>
    <button data-f="mine" type="button">🙋 Moje</button>`;
  $('#view-map').appendChild(filterBar);
  filterBar.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => setFilter(b.dataset.f === 'mine'))
  );
  syncFilterUi();

  map.on('click', onMapClick);
  map.on('pm:create', onPolygonCreate);
  map.on('locationfound', onLocationFound);
  map.on('locationerror', () => {
    stopLocate();
    toast('Polohu se nepodařilo zjistit – zkontroluj povolení GPS', { error: true });
  });
}

function setFilter(mine) {
  filterMine = mine;
  try {
    localStorage.setItem(FILTER_KEY, mine ? 'mine' : 'all');
  } catch {
    /* ignore */
  }
  syncFilterUi();
  render(Store.get('notes'));
}
function syncFilterUi() {
  const bar = $('#map-filter');
  if (!bar) return;
  bar.querySelector('[data-f="all"]').classList.toggle('active', !filterMine);
  bar.querySelector('[data-f="mine"]').classList.toggle('active', filterMine);
}

// ---------- vykreslení (reconcile) ----------
const featureSig = (f) => `${f.updatedAt || f.createdAt}|${f.category}|${f.note}|${f.author}|${f._pending ? 1 : 0}`;

function buildLayer(f) {
  let layer;
  if (f.kind === 'point') {
    const [lng, lat] = f.geometry.coordinates;
    layer = L.marker([lat, lng], { icon: pinIcon(f.category, f.author) });
  } else {
    const ring = f.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
    layer = L.polygon(ring, polygonStyle(catOf(f.category).color, f.author));
  }
  layer.on('click', (e) => {
    L.DomEvent.stop(e);
    if (addPointMode || shapeEditFeature) return;
    openNoteView(f);
  });
  layer.addTo(notesLayer);
  return layer;
}

function render(items) {
  if (!map) return;
  const me = getUser()?.name;
  const visible = filterMine ? items.filter((f) => f.author === me) : items;
  const seen = new Set();
  for (const f of visible) {
    if (!f.geometry || !f.kind) continue;
    seen.add(f.id);
    const sig = featureSig(f);
    const existing = rendered.get(f.id);
    if (existing && existing.sig === sig) continue;
    if (existing) notesLayer.removeLayer(existing.layer);
    rendered.set(f.id, { layer: buildLayer(f), sig });
  }
  for (const [id, r] of rendered) {
    if (!seen.has(id)) {
      notesLayer.removeLayer(r.layer);
      rendered.delete(id);
    }
  }
}

// ---------- přidání bodu / plochy ----------
function setAddPointMode(on) {
  addPointMode = on;
  $('#btn-add-point').classList.toggle('active', on);
  if (map) map.getContainer().style.cursor = on ? 'crosshair' : '';
}

function onMapClick(e) {
  if (!addPointMode) return;
  setAddPointMode(false);
  const temp = L.marker(e.latlng, { icon: pinIcon('observation', getUser()?.name) }).addTo(map);
  openNoteForm('point', { type: 'Point', coordinates: [e.latlng.lng, e.latlng.lat] }, temp);
}

function onPolygonCreate(e) {
  $('#btn-add-area').classList.remove('active');
  map.pm.disableDraw();
  const ring = e.layer.getLatLngs()[0].map((ll) => [ll.lng, ll.lat]);
  ring.push(ring[0]);
  openNoteForm('polygon', { type: 'Polygon', coordinates: [ring] }, e.layer);
}

// ---------- formulář ----------
function noteFormHtml({ title, category = 'observation', note = '', locality = '', editing = false }) {
  const choice = (key) => `
    <button type="button" class="choice ${category === key ? 'selected' : ''}" data-cat="${key}">
      <span class="ic">${CATS[key].icon}</span><span class="nm">${CATS[key].name}</span>
    </button>`;
  const choices = Object.keys(CATS).map(choice).join('');
  return `
    <h2>${escapeHtml(title)}</h2>
    <div class="choice-grid">${choices}</div>
    <div class="field">
      <label>Lokalita</label>
      <select id="note-locality">${localityOptionsHtml(locality)}</select>
    </div>
    <div class="field">
      <label>Poznámka</label>
      <textarea id="note-text" rows="3" placeholder="Např.: tady roste hromada pcháče…">${escapeHtml(note)}</textarea>
    </div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      ${editing ? '<button data-shape type="button">Upravit tvar</button>' : ''}
      ${editing ? '<button class="danger" data-del type="button">Smazat</button>' : ''}
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`;
}

function bindChoice(sheet) {
  let cat = sheet.querySelector('.choice.selected')?.dataset.cat || 'observation';
  sheet.querySelectorAll('.choice').forEach((b) => {
    b.addEventListener('click', () => {
      sheet.querySelectorAll('.choice').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      cat = b.dataset.cat;
    });
  });
  return () => cat;
}

function openNoteForm(kind, geometry, tempLayer) {
  const sheet = openSheet(noteFormHtml({ title: kind === 'point' ? 'Nový bod' : 'Nová plocha' }));
  const getCat = bindChoice(sheet);
  const cleanup = () => {
    if (tempLayer && map.hasLayer(tempLayer)) map.removeLayer(tempLayer);
  };
  sheet.querySelector('[data-cancel]').onclick = () => {
    cleanup();
    closeOverlay();
  };
  sheet.querySelector('[data-save]').onclick = async () => {
    const category = getCat();
    const note = sheet.querySelector('#note-text').value.trim();
    const locality = sheet.querySelector('#note-locality').value;
    cleanup();
    closeOverlay();
    await Store.add('notes', { kind, geometry, category, color: catOf(category).color, note, locality });
    toast('Uloženo ✓');
  };
}

function openNoteView(f) {
  const sheet = openSheet(
    noteFormHtml({ title: 'Poznámka', category: f.category, note: f.note, locality: f.locality, editing: true })
  );
  const meta = document.createElement('p');
  meta.className = 'login-foot';
  meta.style.textAlign = 'left';
  meta.innerHTML = `Vložil(a): <b style="color:${userColor(f.author)}">${escapeHtml(f.author || '?')}</b> · ${escapeHtml(fmtDateTime(f.createdAt))}${f.locality ? ` · 📍 ${escapeHtml(localityName(f.locality))}` : ''}${f._pending ? ' · ⏳ čeká na odeslání' : ''}`;
  sheet.appendChild(meta);
  const getCat = bindChoice(sheet);

  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const category = getCat();
    const note = sheet.querySelector('#note-text').value.trim();
    const locality = sheet.querySelector('#note-locality').value;
    closeOverlay();
    await Store.update('notes', f.id, { category, color: catOf(category).color, note, locality });
    toast('Uloženo ✓');
  };
  const delBtn = sheet.querySelector('[data-del]');
  if (delBtn)
    delBtn.onclick = async () => {
      closeOverlay();
      if (!(await confirmSheet('Opravdu smazat tuhle poznámku?', { okText: 'Smazat', danger: true }))) return;
      await Store.remove('notes', f.id);
      toast('Smazáno');
    };
  const shapeBtn = sheet.querySelector('[data-shape]');
  if (shapeBtn) {
    if (f.kind !== 'polygon') shapeBtn.hidden = true;
    else shapeBtn.onclick = () => startShapeEdit(f);
  }
}

// ---------- úprava tvaru ----------
function startShapeEdit(f) {
  const r = rendered.get(f.id);
  if (!r) return;
  closeOverlay();
  shapeEditFeature = { f, layer: r.layer };
  r.layer.pm.enable({ allowSelfIntersection: false });
  btnFinishShape.hidden = false;
  toast('Tahej za body a uprav tvar, pak klepni na Hotovo', { ms: 4000 });
}
async function finishShapeEdit() {
  if (!shapeEditFeature) return;
  const { f, layer } = shapeEditFeature;
  layer.pm.disable();
  btnFinishShape.hidden = true;
  shapeEditFeature = null;
  const ring = layer.getLatLngs()[0].map((ll) => [ll.lng, ll.lat]);
  ring.push(ring[0]);
  await Store.update('notes', f.id, { geometry: { type: 'Polygon', coordinates: [ring] } });
  toast('Tvar uložen ✓');
}
function cancelShapeEdit() {
  if (!shapeEditFeature) return;
  shapeEditFeature.layer.pm.disable();
  shapeEditFeature = null;
  if (btnFinishShape) btnFinishShape.hidden = true;
}

// ---------- poloha ----------
function stopLocate() {
  if (map) map.stopLocate();
  locating = false;
  $('#btn-locate').classList.remove('active');
  if (locateDot) {
    map.removeLayer(locateDot);
    locateDot = null;
  }
  if (locateCircle) {
    map.removeLayer(locateCircle);
    locateCircle = null;
  }
}
function onLocationFound(e) {
  lastPosition = e.latlng;
  if (!locating) return;
  if (!locateDot) {
    locateDot = L.marker(e.latlng, {
      icon: L.divIcon({ className: '', html: '<div class="locate-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
    }).addTo(map);
    locateCircle = L.circle(e.latlng, { radius: e.accuracy, weight: 1, color: '#1a73e8', fillOpacity: 0.1, interactive: false }).addTo(map);
  } else {
    locateDot.setLatLng(e.latlng);
    locateCircle.setLatLng(e.latlng).setRadius(e.accuracy);
  }
  if (firstFix) {
    firstFix = false;
    map.setView(e.latlng, Math.max(map.getZoom(), 17));
  }
}

// ---------- nástroje / menu ----------
function wireTools() {
  $('#btn-add-point').addEventListener('click', () => {
    cancelShapeEdit();
    map.pm.disableDraw();
    if (addPointMode) {
      setAddPointMode(false);
      return;
    }
    setAddPointMode(true);
    toast('Klepni do mapy, kam chceš dát bod');
  });

  $('#btn-add-area').addEventListener('click', () => {
    cancelShapeEdit();
    setAddPointMode(false);
    if (map.pm.globalDrawModeEnabled()) {
      map.pm.disableDraw();
      $('#btn-add-area').classList.remove('active');
      return;
    }
    $('#btn-add-area').classList.add('active');
    toast('Klepáním obtáhni plochu, ukonči klepnutím na první bod', { ms: 4000 });
    map.pm.enableDraw('Polygon', {
      snappable: false,
      continueDrawing: false,
      pathOptions: polygonStyle(CATS.observation.color, getUser()?.name),
      templineStyle: { color: CATS.observation.color, weight: 2 },
      hintlineStyle: { color: CATS.observation.color, weight: 2, dashArray: '5,5' },
    });
  });

  $('#btn-locate').addEventListener('click', () => {
    if (locating) {
      stopLocate();
      return;
    }
    locating = true;
    firstFix = true;
    $('#btn-locate').classList.add('active');
    toast('Hledám polohu…');
    map.locate({ watch: true, enableHighAccuracy: true });
  });

  $('#btn-map-menu').addEventListener('click', () => openOverlay($('#map-menu-panel')));
  $('#btn-map-menu-close').addEventListener('click', closeOverlay);
  $('#btn-home').addEventListener('click', () => {
    closeOverlay();
    map.fitBounds(perimeter.getBounds());
  });
  $('#btn-point-here').addEventListener('click', () => {
    closeOverlay();
    if (lastPosition) {
      const temp = L.marker(lastPosition, { icon: pinIcon('observation', getUser()?.name) }).addTo(map);
      map.setView(lastPosition, Math.max(map.getZoom(), 17));
      openNoteForm('point', { type: 'Point', coordinates: [lastPosition.lng, lastPosition.lat] }, temp);
    } else {
      toast('Nejdřív zapni Polohu, ať vím, kde stojíš');
    }
  });
  $('#btn-export').addEventListener('click', () => {
    closeOverlay();
    const items = Store.get('notes');
    const gj = {
      type: 'FeatureCollection',
      features: items.map((f) => ({
        type: 'Feature',
        properties: { category: f.category, locality: localityName(f.locality), note: f.note, author: f.author, createdAt: f.createdAt },
        geometry: f.geometry,
      })),
    };
    const blob = new Blob([JSON.stringify(gj, null, 2)], { type: 'application/geo+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rudolticka-body.geojson';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Body exportovány');
  });
}

export const MapView = {
  collections: ['notes'],
  mount() {
    initMap();
    wireTools();
    Store.subscribe('notes', render);
  },
  onShow() {
    if (map) setTimeout(() => map.invalidateSize(), 80);
  },
  onHide() {
    cancelShapeEdit();
    setAddPointMode(false);
    if (map && map.pm) map.pm.disableDraw();
  },
};
