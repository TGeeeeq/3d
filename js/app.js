/* Lukávka – interaktivní mapa poznámek (body a plochy) nad revitalizovaným tokem. */
'use strict';

// ---------- konstanty ----------

const STORAGE_KEY = 'lukavka.notes.v1';
const BASEMAP_KEY = 'lukavka.basemap.v1';
const DEFAULT_COLOR = '#e53935';

// Obálka celé revitalizace včetně obou ramen (Lukávka u Damníkova).
const STREAM_BOUNDS = L.latLngBounds([49.916, 16.520], [49.938, 16.550]);

// ---------- mapa a podklady ----------

const map = L.map('map', { zoomControl: true, attributionControl: true });
map.fitBounds(STREAM_BOUNDS);

const baseLayers = {
  'Letecká ČÚZK': L.tileLayer(
    'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 20, maxZoom: 21, attribution: '© ČÚZK' }
  ),
  'Letecká Esri': L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 19, maxZoom: 21, attribution: '© Esri' }
  ),
  'Obyčejná mapa': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }),
};

const savedBase = localStorage.getItem(BASEMAP_KEY);
(baseLayers[savedBase] || baseLayers['Letecká ČÚZK']).addTo(map);
L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
map.on('baselayerchange', (e) => localStorage.setItem(BASEMAP_KEY, e.name));

// ---------- stav ----------

const notesLayer = L.layerGroup().addTo(map);
let features = []; // {id, kind:'point'|'polygon', geometry, color, note, createdAt, layer}

// Stav otevřeného formuláře: {mode:'new'|'view', kind, tempLayer?, feature?}
let sheetState = null;
let addPointMode = false;
let shapeEditFeature = null;

// ---------- DOM ----------

const $ = (id) => document.getElementById(id);
const toolbar = $('toolbar');
const noteSheet = $('note-sheet');
const menuPanel = $('menu-panel');
const backdrop = $('backdrop');
const noteText = $('note-text');

let toastTimer = null;
function toast(msg, ms = 2500) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- ukládání ----------

function toGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: { id: f.id, note: f.note, color: f.color, createdAt: f.createdAt },
      geometry: f.geometry,
    })),
  };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toGeoJSON()));
}

function load() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    data = null;
  }
  if (data && Array.isArray(data.features)) {
    data.features.forEach(addFeatureFromGeoJSON);
  }
}

function addFeatureFromGeoJSON(gj) {
  if (!gj || !gj.geometry) return;
  const kind = gj.geometry.type === 'Point' ? 'point' : gj.geometry.type === 'Polygon' ? 'polygon' : null;
  if (!kind) return;
  const p = gj.properties || {};
  const feature = {
    id: p.id || String(Date.now()) + Math.random().toString(36).slice(2, 7),
    kind,
    geometry: gj.geometry,
    color: p.color || DEFAULT_COLOR,
    note: p.note || '',
    createdAt: p.createdAt || new Date().toISOString(),
    layer: null,
  };
  feature.layer = buildLayer(feature);
  features.push(feature);
}

// ---------- vykreslení ----------

function pinIcon(color) {
  return L.divIcon({
    className: '',
    html: `<span class="note-pin" style="background:${color}"></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 24],
  });
}

function buildLayer(feature) {
  let layer;
  if (feature.kind === 'point') {
    const [lng, lat] = feature.geometry.coordinates;
    layer = L.marker([lat, lng], { icon: pinIcon(feature.color) });
  } else {
    const ring = feature.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
    layer = L.polygon(ring, polygonStyle(feature.color));
  }
  layer.on('click', (e) => {
    L.DomEvent.stop(e);
    if (addPointMode || shapeEditFeature) return;
    openSheetForView(feature);
  });
  layer.addTo(notesLayer);
  return layer;
}

function polygonStyle(color) {
  return { color, weight: 3, fillColor: color, fillOpacity: 0.25 };
}

function restyleFeature(feature) {
  if (feature.kind === 'point') {
    feature.layer.setIcon(pinIcon(feature.color));
  } else {
    feature.layer.setStyle(polygonStyle(feature.color));
  }
}

function removeFeature(feature) {
  notesLayer.removeLayer(feature.layer);
  features = features.filter((f) => f !== feature);
  save();
}

// ---------- bottom sheet (formulář poznámky) ----------

function selectedColor() {
  const el = document.querySelector('.color-swatch.selected');
  return el ? el.dataset.color : DEFAULT_COLOR;
}

function setSelectedColor(color) {
  document.querySelectorAll('.color-swatch').forEach((el) => {
    el.classList.toggle('selected', el.dataset.color === color);
  });
}

function openSheet(state) {
  sheetState = state;
  $('note-sheet-title').textContent =
    state.mode === 'new'
      ? state.kind === 'point' ? 'Nový bod' : 'Nová plocha'
      : 'Poznámka';
  noteText.value = state.mode === 'view' ? state.feature.note : '';
  setSelectedColor(state.mode === 'view' ? state.feature.color : DEFAULT_COLOR);
  $('btn-delete').hidden = state.mode !== 'view';
  $('btn-edit-shape').hidden = !(state.mode === 'view' && state.feature.kind === 'polygon');
  noteSheet.hidden = false;
  backdrop.hidden = false;
}

function closeSheet(discardTemp) {
  if (discardTemp && sheetState && sheetState.tempLayer) {
    map.removeLayer(sheetState.tempLayer);
  }
  sheetState = null;
  noteSheet.hidden = true;
  backdrop.hidden = true;
}

function openSheetForView(feature) {
  closeMenu();
  openSheet({ mode: 'view', kind: feature.kind, feature });
}

$('btn-save').addEventListener('click', () => {
  if (!sheetState) return;
  const color = selectedColor();
  const note = noteText.value.trim();

  if (sheetState.mode === 'new') {
    let geometry;
    if (sheetState.kind === 'point') {
      const ll = sheetState.tempLayer.getLatLng();
      geometry = { type: 'Point', coordinates: [ll.lng, ll.lat] };
    } else {
      geometry = ringGeometry(sheetState.tempLayer);
    }
    map.removeLayer(sheetState.tempLayer);
    sheetState.tempLayer = null;
    addFeatureFromGeoJSON({
      type: 'Feature',
      properties: { note, color, createdAt: new Date().toISOString() },
      geometry,
    });
  } else {
    const f = sheetState.feature;
    f.note = note;
    f.color = color;
    restyleFeature(f);
  }
  save();
  closeSheet(false);
  toast('Uloženo ✓');
});

$('btn-cancel').addEventListener('click', () => closeSheet(true));
backdrop.addEventListener('click', () => { closeSheet(true); closeMenu(); });

$('btn-delete').addEventListener('click', () => {
  if (!sheetState || sheetState.mode !== 'view') return;
  if (confirm('Opravdu smazat tuhle poznámku?')) {
    removeFeature(sheetState.feature);
    closeSheet(false);
    toast('Smazáno');
  }
});

document.querySelectorAll('.color-swatch').forEach((el) => {
  el.addEventListener('click', () => setSelectedColor(el.dataset.color));
});

function ringGeometry(layer) {
  const ring = layer.getLatLngs()[0].map((ll) => [ll.lng, ll.lat]);
  ring.push(ring[0]); // GeoJSON polygon musí být uzavřený
  return { type: 'Polygon', coordinates: [ring] };
}

// ---------- přidání bodu ----------

const btnAddPoint = $('btn-add-point');

function setAddPointMode(on) {
  addPointMode = on;
  btnAddPoint.classList.toggle('active', on);
  map.getContainer().style.cursor = on ? 'crosshair' : '';
}

btnAddPoint.addEventListener('click', () => {
  cancelShapeEdit();
  map.pm.disableDraw();
  if (addPointMode) {
    setAddPointMode(false);
    return;
  }
  setAddPointMode(true);
  toast('Klepni do mapy, kam chceš dát bod');
});

map.on('click', (e) => {
  if (!addPointMode || sheetState) return;
  setAddPointMode(false);
  const temp = L.marker(e.latlng, { icon: pinIcon(DEFAULT_COLOR) }).addTo(map);
  openSheet({ mode: 'new', kind: 'point', tempLayer: temp });
});

// ---------- přidání plochy ----------

const btnAddArea = $('btn-add-area');

btnAddArea.addEventListener('click', () => {
  cancelShapeEdit();
  setAddPointMode(false);
  if (map.pm.globalDrawModeEnabled()) {
    map.pm.disableDraw();
    btnAddArea.classList.remove('active');
    return;
  }
  btnAddArea.classList.add('active');
  toast('Klepáním obtáhni plochu, ukonči klepnutím na první bod', 4000);
  map.pm.enableDraw('Polygon', {
    snappable: false,
    continueDrawing: false,
    pathOptions: polygonStyle(DEFAULT_COLOR),
    templineStyle: { color: DEFAULT_COLOR, weight: 2 },
    hintlineStyle: { color: DEFAULT_COLOR, weight: 2, dashArray: '5,5' },
  });
});

map.on('pm:create', (e) => {
  btnAddArea.classList.remove('active');
  map.pm.disableDraw();
  openSheet({ mode: 'new', kind: 'polygon', tempLayer: e.layer });
});

map.on('pm:drawend', () => btnAddArea.classList.remove('active'));

// ---------- úprava tvaru plochy ----------

const btnFinishShape = document.createElement('button');
btnFinishShape.type = 'button';
btnFinishShape.className = 'tool-btn';
btnFinishShape.textContent = '✓ Hotovo';
btnFinishShape.style.cssText =
  'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(76px + env(safe-area-inset-bottom));' +
  'z-index:1000;min-width:140px;background:#1e3a2f;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4);';
btnFinishShape.hidden = true;
document.body.appendChild(btnFinishShape);

$('btn-edit-shape').addEventListener('click', () => {
  if (!sheetState || sheetState.mode !== 'view') return;
  shapeEditFeature = sheetState.feature;
  closeSheet(false);
  shapeEditFeature.layer.pm.enable({ allowSelfIntersection: false });
  btnFinishShape.hidden = false;
  toast('Tahej za body a uprav tvar, pak klepni na Hotovo', 4000);
});

btnFinishShape.addEventListener('click', () => {
  if (!shapeEditFeature) return;
  shapeEditFeature.layer.pm.disable();
  shapeEditFeature.geometry = ringGeometry(shapeEditFeature.layer);
  save();
  shapeEditFeature = null;
  btnFinishShape.hidden = true;
  toast('Tvar uložen ✓');
});

function cancelShapeEdit() {
  if (!shapeEditFeature) return;
  shapeEditFeature.layer.pm.disable();
  shapeEditFeature = null;
  btnFinishShape.hidden = true;
}

// ---------- moje poloha ----------

const btnLocate = $('btn-locate');
let locating = false;
let lastPosition = null;
let locateDot = null;
let locateCircle = null;
let firstFix = false;

function stopLocate() {
  map.stopLocate();
  locating = false;
  btnLocate.classList.remove('active');
  if (locateDot) { map.removeLayer(locateDot); locateDot = null; }
  if (locateCircle) { map.removeLayer(locateCircle); locateCircle = null; }
}

btnLocate.addEventListener('click', () => {
  if (locating) {
    stopLocate();
    return;
  }
  locating = true;
  firstFix = true;
  btnLocate.classList.add('active');
  toast('Hledám polohu…');
  map.locate({ watch: true, enableHighAccuracy: true });
});

map.on('locationfound', (e) => {
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
});

map.on('locationerror', () => {
  stopLocate();
  toast('Polohu se nepodařilo zjistit – zkontroluj povolení GPS');
});

// ---------- menu ----------

function openMenu() {
  menuPanel.hidden = false;
  backdrop.hidden = false;
}

function closeMenu() {
  menuPanel.hidden = true;
  if (!sheetState) backdrop.hidden = true;
}

$('btn-menu').addEventListener('click', () => {
  closeSheet(true);
  openMenu();
});
$('btn-menu-close').addEventListener('click', closeMenu);

$('btn-home').addEventListener('click', () => {
  closeMenu();
  map.fitBounds(STREAM_BOUNDS);
});

$('btn-point-here').addEventListener('click', () => {
  closeMenu();
  if (lastPosition) {
    const temp = L.marker(lastPosition, { icon: pinIcon(DEFAULT_COLOR) }).addTo(map);
    map.setView(lastPosition, Math.max(map.getZoom(), 17));
    openSheet({ mode: 'new', kind: 'point', tempLayer: temp });
  } else {
    toast('Nejdřív zapni Polohu, ať vím, kde stojíš');
  }
});

// ---------- export / import ----------

$('btn-export').addEventListener('click', () => {
  closeMenu();
  const blob = new Blob([JSON.stringify(toGeoJSON(), null, 2)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lukavka-poznamky.geojson';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Poznámky exportovány');
});

$('btn-import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', (e) => {
  closeMenu();
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      toast('Soubor se nepodařilo přečíst');
      return;
    }
    if (!data || !Array.isArray(data.features)) {
      toast('Tohle nevypadá jako GeoJSON s poznámkami');
      return;
    }
    if (features.length > 0) {
      const merge = confirm('Přidat k existujícím poznámkám?\nOK = přidat, Zrušit = nahradit všechny');
      if (!merge) {
        features.forEach((f) => notesLayer.removeLayer(f.layer));
        features = [];
      }
    }
    data.features.forEach(addFeatureFromGeoJSON);
    save();
    toast(`Načteno ✓ (celkem ${features.length} poznámek)`);
  };
  reader.readAsText(file);
});

// ---------- start ----------

load();
save();
