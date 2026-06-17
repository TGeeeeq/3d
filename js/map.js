// Mapa: sdílené body a plochy. Region = 20 km okruh kolem Ostrova (max dosah lokalit).
// Potok s meandry = Rudoltička (u Rudoltic / Ostrova). Volba kategorie + barva autora.
'use strict';
import { Store } from './store.js';
import {
  $, toast, openSheet, openOverlay, closeOverlay, escapeHtml, fmtDateTime, confirmSheet, getUser, userColor, authorChip,
} from './ui.js';
import { localityOptionsHtml, localityName } from './localities-data.js';
import { AREA_TYPES, AREA_TYPE_ORDER, areaType, REFERENCE_ZCHU, importProtectedAreas } from './protected-areas-data.js';
import { deleteButton, requestDelete } from './actions.js';

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
let areasLayer = null; // editovatelná chráněná území (kolekce areas)
let refLayer = null; // okolní ZCHÚ – jen reference (bundlovaná data)
let perimeter = null;
const rendered = new Map(); // id -> { layer, sig }
const renderedAreas = new Map(); // id -> { layer, sig }
let addPointMode = false;
let drawForAreaId = null; // když kreslíme tvar pro konkrétní území ze seznamu
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

  // Vrstvy chráněných území: obě zapnuté (lze vypnout v přepínači vrstev vpravo nahoře).
  notesLayer = L.layerGroup().addTo(map);
  areasLayer = L.layerGroup().addTo(map);
  refLayer = buildReferenceLayer().addTo(map);
  L.control
    .layers(
      baseLayers,
      { '🛡️ Naše území': areasLayer, '📚 Okolní ZCHÚ': refLayer },
      { position: 'topright', collapsed: true }
    )
    .addTo(map);
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
    openNotePreview(f);
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

// ---------- chráněná území (editovatelná vrstva + reference) ----------
// GeoJSON [lng,lat] -> Leaflet [lat,lng] pro Polygon i MultiPolygon.
function geoToLatLngs(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng])));
  }
  return null;
}

function buildReferenceLayer() {
  const grp = L.layerGroup();
  for (const a of REFERENCE_ZCHU) {
    const latlngs = geoToLatLngs(a.geometry);
    if (!latlngs) continue;
    const poly = L.polygon(latlngs, {
      color: '#1565c0', weight: 2.5, fillColor: '#1e88e5', fillOpacity: 0.18, dashArray: '6,4', interactive: true,
    });
    const link = a.usopUrl ? `<br><a href="${a.usopUrl}" target="_blank" rel="noopener">Záznam v ÚSOP →</a>` : '';
    poly.bindPopup(
      `<b>${escapeHtml(a.kat ? a.kat + ' ' : '')}${escapeHtml(a.name)}</b>` +
      `${a.areaHa ? `<br>${a.areaHa} ha` : ''}<br><span style="color:#667">Okolní ZCHÚ · reference (AOPK ČR)</span>${link}`
    );
    poly.bindTooltip(escapeHtml(a.name), { direction: 'center', className: 'area-label' });
    grp.addLayer(poly);
  }
  return grp;
}

const areaSig = (a) => `${a.updatedAt || a.createdAt}|${a.type}|${a.name}|${a.geometry ? 'g' : '0'}|${a._pending ? 1 : 0}`;

function buildAreaLayer(a) {
  const latlngs = geoToLatLngs(a.geometry);
  if (!latlngs) return null; // bez zákresu se na mapě nezobrazuje (je v seznamu)
  const t = areaType(a.type);
  const layer = L.polygon(latlngs, {
    color: t.color, weight: a.source === 'aopk' ? 3 : 2,
    fillColor: t.color, fillOpacity: 0.18,
    dashArray: a.source === 'malek' ? '6,5' : null,
  });
  layer.on('click', (e) => {
    L.DomEvent.stop(e);
    if (addPointMode || shapeEditFeature || drawForAreaId) return;
    openAreaPreview(a);
  });
  layer.addTo(areasLayer);
  return layer;
}

function dedupeAreas(items) {
  const bySeed = new Set();
  return items.filter((a) => {
    if (!a.seedId) return true;
    if (bySeed.has(a.seedId)) return false;
    bySeed.add(a.seedId);
    return true;
  });
}

function renderAreas(rawItems) {
  if (!map || !areasLayer) return;
  const items = dedupeAreas(rawItems);
  const seen = new Set();
  for (const a of items) {
    seen.add(a.id);
    const sig = areaSig(a);
    const existing = renderedAreas.get(a.id);
    if (existing && existing.sig === sig) continue;
    if (existing) areasLayer.removeLayer(existing.layer);
    const layer = buildAreaLayer(a);
    if (layer) renderedAreas.set(a.id, { layer, sig });
    else renderedAreas.delete(a.id);
  }
  for (const [id, r] of renderedAreas) {
    if (!seen.has(id)) {
      areasLayer.removeLayer(r.layer);
      renderedAreas.delete(id);
    }
  }
}

function areaFormHtml(a) {
  const choices = AREA_TYPE_ORDER.map((key) => `
    <button type="button" class="choice ${a.type === key ? 'selected' : ''}" data-cat="${key}">
      <span class="ic">${AREA_TYPES[key].icon}</span><span class="nm">${AREA_TYPES[key].label}</span>
    </button>`).join('');
  const official = a.source === 'aopk'
    ? `<p class="login-foot" style="text-align:left;margin:2px 0 8px">🛡️ Oficiální hranice AOPK ČR (ÚSOP).${a.usopUrl ? ` <a href="${escapeHtml(a.usopUrl)}" target="_blank" rel="noopener">Záznam →</a>` : ''}</p>`
    : '';
  return `
    <h2>${escapeHtml(a.name || 'Chráněné území')}</h2>
    ${official}
    <div class="choice-grid">${choices}</div>
    <div class="field"><label>Název</label><input id="a-name" type="text" maxlength="120" value="${escapeHtml(a.name || '')}"></div>
    <div class="field"><label>Rozloha</label><input id="a-area" type="text" maxlength="40" placeholder="např. 23 ha" value="${escapeHtml(a.areaText || '')}"></div>
    <div class="field"><label>Popis</label><textarea id="a-desc" rows="3" maxlength="600">${escapeHtml(a.desc || '')}</textarea></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button data-shape type="button">${a.geometry ? 'Upravit tvar' : '🗺️ Zakreslit na mapě'}</button>
      ${deleteButton(a, { mineCls: 'danger', proposeCls: 'secondary', style: '' })}
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`;
}

function openAreaView(a) {
  const sheet = openSheet(areaFormHtml(a));
  let type = a.type;
  sheet.querySelectorAll('.choice').forEach((b) =>
    b.addEventListener('click', () => {
      sheet.querySelectorAll('.choice').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      type = b.dataset.cat;
    })
  );
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const name = sheet.querySelector('#a-name').value.trim();
    if (!name) {
      toast('Zadej název');
      return;
    }
    closeOverlay();
    await Store.update('areas', a.id, {
      name, type,
      areaText: sheet.querySelector('#a-area').value.trim(),
      desc: sheet.querySelector('#a-desc').value.trim(),
    });
    toast('Uloženo ✓');
  };
  sheet.querySelector('[data-reqdel]').onclick = async () => {
    closeOverlay();
    await requestDelete('areas', a, a.name);
  };
  sheet.querySelector('[data-shape]').onclick = () => {
    closeOverlay();
    if (a.geometry) startShapeEdit(a, 'areas');
    else startDrawArea(a.id);
  };
}

// Spustí kreslení tvaru pro dané území (volá se i ze záložky Lokality přes událost).
function startDrawArea(id) {
  cancelShapeEdit();
  setAddPointMode(false);
  drawForAreaId = id;
  if (!map.hasLayer(areasLayer)) areasLayer.addTo(map); // ať je vrstva vidět
  toast('Obtáhni hranici území klepáním, ukonči u prvního bodu', { ms: 4500 });
  map.pm.enableDraw('Polygon', {
    snappable: false,
    continueDrawing: false,
    pathOptions: polygonStyle(AREA_TYPES.zchu.color, getUser()?.name),
    templineStyle: { color: AREA_TYPES.zchu.color, weight: 2 },
    hintlineStyle: { color: AREA_TYPES.zchu.color, weight: 2, dashArray: '5,5' },
  });
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
  // Kreslíme tvar pro konkrétní chráněné území (ze seznamu „Zakreslit")?
  if (drawForAreaId) {
    const id = drawForAreaId;
    drawForAreaId = null;
    map.removeLayer(e.layer);
    Store.update('areas', id, { geometry: { type: 'Polygon', coordinates: [ring] } });
    toast('Zákres uložen ✓');
    return;
  }
  openNoteForm('polygon', { type: 'Polygon', coordinates: [ring] }, e.layer);
}

// ---------- formulář ----------
function noteFormHtml({ title, category = 'observation', note = '', locality = '', editing = false, item = null }) {
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
      ${editing && item ? deleteButton(item, { mineCls: 'danger', proposeCls: 'secondary', style: '' }) : ''}
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

// Kompaktní náhled poznámky – jen info + tlačítka (úpravy se otevřou přes „Upravit").
function openNotePreview(f) {
  const c = catOf(f.category);
  const loc = f.locality ? localityName(f.locality) : '';
  const sheet = openSheet(`
    <h2 style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:24px">${c.icon}</span>${escapeHtml(c.name)}</h2>
    <div class="meta" style="margin-bottom:8px">
      ${authorChip(f.author)}
      <span>${escapeHtml(fmtDateTime(f.createdAt))}</span>
      ${loc ? `<span class="pill cat">📍 ${escapeHtml(loc)}</span>` : ''}
      ${f._pending ? '<span class="pend">⏳</span>' : ''}
    </div>
    ${f.note ? `<div class="body">${escapeHtml(f.note)}</div>` : '<div class="body" style="color:var(--muted)">(bez poznámky)</div>'}
    <div class="sheet-buttons" style="margin-top:12px">
      <button class="primary" data-edit type="button">✏️ Upravit</button>
      ${deleteButton(f, { mineCls: 'danger', proposeCls: 'secondary', style: '' })}
      <button class="secondary" data-cancel type="button">Zavřít</button>
    </div>`);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-edit]').onclick = () => {
    closeOverlay();
    openNoteView(f);
  };
  sheet.querySelector('[data-reqdel]').onclick = async () => {
    closeOverlay();
    await requestDelete('notes', f, f.note || c.name);
  };
}

// Kompaktní náhled chráněného území.
function openAreaPreview(a) {
  const t = areaType(a.type);
  const official = a.source === 'aopk' ? '<span class="pill author" style="background:#2e7d3220;color:#2e7d32">AOPK</span>' : '';
  const link = a.usopUrl ? `<a class="pill cat" href="${escapeHtml(a.usopUrl)}" target="_blank" rel="noopener">ÚSOP →</a>` : '';
  const sheet = openSheet(`
    <h2 style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:24px">${t.icon}</span>${escapeHtml(a.name)}</h2>
    <div class="meta" style="margin-bottom:8px">
      <span class="pill cat">${escapeHtml(t.label)}</span>
      ${a.areaText ? `<span class="pill cat">${escapeHtml(a.areaText)}</span>` : ''}
      ${official}${link}
      ${a.geometry ? '' : '<span class="pill money-out">▢ bez zákresu</span>'}
    </div>
    ${a.desc ? `<div class="body">${escapeHtml(a.desc)}</div>` : ''}
    <div class="sheet-buttons" style="margin-top:12px">
      <button class="primary" data-edit type="button">✏️ Upravit</button>
      ${deleteButton(a, { mineCls: 'danger', proposeCls: 'secondary', style: '' })}
      <button class="secondary" data-cancel type="button">Zavřít</button>
    </div>`);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-edit]').onclick = () => {
    closeOverlay();
    openAreaView(a);
  };
  sheet.querySelector('[data-reqdel]').onclick = async () => {
    closeOverlay();
    await requestDelete('areas', a, a.name);
  };
}

function openNoteForm(kind, geometry, tempLayer) {
  const cleanup = () => {
    if (tempLayer && map.hasLayer(tempLayer)) map.removeLayer(tempLayer);
  };
  // cleanup se spustí i při zavření přes pozadí – dočasný špendlík/plocha tak nikdy nezůstane viset.
  const sheet = openSheet(noteFormHtml({ title: kind === 'point' ? 'Nový bod' : 'Nová plocha' }), cleanup);
  const getCat = bindChoice(sheet);
  sheet.querySelector('[data-cancel]').onclick = () => {
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
    noteFormHtml({ title: 'Poznámka', category: f.category, note: f.note, locality: f.locality, editing: true, item: f })
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
  const delBtn = sheet.querySelector('[data-reqdel]');
  if (delBtn)
    delBtn.onclick = async () => {
      closeOverlay();
      await requestDelete('notes', f, f.note || catOf(f.category).name);
    };
  const shapeBtn = sheet.querySelector('[data-shape]');
  if (shapeBtn) {
    if (f.kind !== 'polygon') shapeBtn.hidden = true;
    else shapeBtn.onclick = () => startShapeEdit(f);
  }
}

// ---------- úprava tvaru ----------
function startShapeEdit(f, collection = 'notes') {
  const r = (collection === 'areas' ? renderedAreas : rendered).get(f.id);
  if (!r) return;
  closeOverlay();
  shapeEditFeature = { f, layer: r.layer, collection };
  r.layer.pm.enable({ allowSelfIntersection: false });
  btnFinishShape.hidden = false;
  toast('Tahej za body a uprav tvar, pak klepni na Hotovo', { ms: 4000 });
}
async function finishShapeEdit() {
  if (!shapeEditFeature) return;
  const { f, layer, collection } = shapeEditFeature;
  layer.pm.disable();
  btnFinishShape.hidden = true;
  shapeEditFeature = null;
  const ring = layer.getLatLngs()[0].map((ll) => [ll.lng, ll.lat]);
  ring.push(ring[0]);
  await Store.update(collection, f.id, { geometry: { type: 'Polygon', coordinates: [ring] } });
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
    drawForAreaId = null;
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
    drawForAreaId = null;
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
  $('#btn-import-areas').addEventListener('click', async () => {
    closeOverlay();
    if (!(await confirmSheet('Načíst oficiální hranice ZCHÚ z AOPK a založit lokální VKP/biocentra k zakreslení?', { okText: 'Načíst' }))) return;
    toast('Načítám chráněná území…');
    try {
      const added = await importProtectedAreas();
      toast(added ? `Přidáno ${added} území ✓` : 'Vše už je načteno', { ms: 3200 });
    } catch {
      toast('Import se nezdařil – zkus to online', { error: true });
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

// Při prvním otevření mapy chráněná území samy naimportujeme, ať jsou hned vidět.
let autoSeedTried = false;
async function maybeAutoSeedAreas() {
  if (autoSeedTried) return;
  autoSeedTried = true;
  try {
    await Store.refresh('areas');
    if (Store.get('areas').length === 0) {
      const n = await importProtectedAreas();
      if (n) toast(`Načteno ${n} chráněných území 🛡️`, { ms: 3000 });
    }
  } catch {
    /* offline – import půjde ručně přes menu */
  }
}

export const MapView = {
  collections: ['notes', 'areas'],
  mount() {
    initMap();
    wireTools();
    Store.subscribe('notes', render);
    Store.subscribe('areas', renderAreas);
    maybeAutoSeedAreas();
  },
  onShow() {
    if (map) setTimeout(() => map.invalidateSize(), 80);
  },
  onHide() {
    cancelShapeEdit();
    drawForAreaId = null;
    setAddPointMode(false);
    if (map && map.pm) map.pm.disableDraw();
  },
  // Volá app.js po přepnutí na mapu (ze seznamu „Zakreslit / Na mapě").
  focusArea(id) {
    const a = Store.get('areas').find((x) => x.id === id);
    if (!a) return;
    if (a.geometry) {
      const r = renderedAreas.get(id);
      if (r) {
        try {
          map.fitBounds(r.layer.getBounds(), { maxZoom: 17, padding: [40, 40] });
        } catch {
          /* ignore */
        }
      }
      openAreaView(a);
    } else {
      startDrawArea(id);
    }
  },
};
