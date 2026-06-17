// Lokality ve správě: editovatelná chráněná území (ZCHÚ/VKP/ÚSES) + vlastní lokality.
'use strict';
import { Store } from './store.js';
import {
  $, toast, openSheet, closeOverlay, escapeHtml, authorChip, userColor, fmtDate, confirmSheet,
} from './ui.js';
import { LOCALITIES, localitiesByType } from './localities-data.js';
import { AREA_TYPES, AREA_TYPE_ORDER, importProtectedAreas } from './protected-areas-data.js';
import { deleteButton, wireDeleteButtons, requestDelete } from './actions.js';

// ---------- vlastní lokality (mimo seznam) ----------
function openForm() {
  const sheet = openSheet(`
    <h2>Nová lokalita</h2>
    <div class="field"><label>Název</label><input id="l-name" type="text" placeholder="např. Ostrov u Lanškrouna" maxlength="100"></div>
    <div class="field"><label>Místo / katastr</label><input id="l-place" type="text" placeholder="obec, k. ú." maxlength="100"></div>
    <div class="field"><label>Rozloha</label><input id="l-area" type="text" placeholder="např. 1,2 ha" maxlength="40"></div>
    <div class="field"><label>Popis / co tu řešíme</label><textarea id="l-desc" rows="3" maxlength="600"></textarea></div>
    <div class="field"><label>Odkaz (web/mapa)</label><input id="l-link" type="url" placeholder="https://…" maxlength="300"></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const name = sheet.querySelector('#l-name').value.trim();
    if (!name) {
      toast('Zadej název lokality');
      return;
    }
    const data = {
      name,
      place: sheet.querySelector('#l-place').value.trim(),
      area: sheet.querySelector('#l-area').value.trim(),
      description: sheet.querySelector('#l-desc').value.trim(),
      link: sheet.querySelector('#l-link').value.trim(),
    };
    closeOverlay();
    await Store.add('localities', data);
    toast('Lokalita uložena ✓');
  };
}

function safeLink(url) {
  return /^https?:\/\//i.test(url) ? url : '';
}

// ---------- chráněná území (editovatelná vrstva) ----------
function areasByType(items) {
  return AREA_TYPE_ORDER
    .map((type) => ({ type, meta: AREA_TYPES[type], items: items.filter((a) => a.type === type) }))
    .filter((g) => g.items.length);
}

// Náhled oficiálního katalogu (než se území naimportují).
function catalogHtml() {
  return localitiesByType()
    .map(
      (g) => `
      <div class="list-divider">${g.meta.icon} ${g.meta.label} · ${g.items.length}</div>
      ${g.items
        .map(
          (l) => `
        <div class="card" style="border-left:4px solid var(--leaf)">
          <h3>${escapeHtml(l.name)}</h3>
          ${l.area ? `<div class="meta"><span class="pill cat">${escapeHtml(l.area)}</span></div>` : ''}
          <div class="body" style="margin-top:6px">${escapeHtml(l.desc)}</div>
        </div>`
        )
        .join('')}`
    )
    .join('');
}

function openAreaEdit(a) {
  const choices = AREA_TYPE_ORDER.map((key) => `
    <button type="button" class="choice ${a.type === key ? 'selected' : ''}" data-cat="${key}">
      <span class="ic">${AREA_TYPES[key].icon}</span><span class="nm">${AREA_TYPES[key].label}</span>
    </button>`).join('');
  const official = a.source === 'aopk'
    ? `<p class="login-foot" style="text-align:left;margin:2px 0 8px">🛡️ Oficiální hranice AOPK ČR.${a.usopUrl ? ` <a href="${escapeHtml(a.usopUrl)}" target="_blank" rel="noopener">Záznam →</a>` : ''}</p>`
    : '';
  const sheet = openSheet(`
    <h2>${escapeHtml(a.name || 'Chráněné území')}</h2>
    ${official}
    <div class="choice-grid">${choices}</div>
    <div class="field"><label>Název</label><input id="a-name" type="text" maxlength="120" value="${escapeHtml(a.name || '')}"></div>
    <div class="field"><label>Rozloha</label><input id="a-area" type="text" maxlength="40" value="${escapeHtml(a.areaText || '')}"></div>
    <div class="field"><label>Popis</label><textarea id="a-desc" rows="3" maxlength="600">${escapeHtml(a.desc || '')}</textarea></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button data-map type="button">${a.geometry ? '🗺️ Ukázat / upravit v mapě' : '🗺️ Zakreslit v mapě'}</button>
      ${deleteButton(a, { mineCls: 'danger', proposeCls: 'secondary', style: '' })}
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
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
  sheet.querySelector('[data-map]').onclick = () => {
    closeOverlay();
    window.dispatchEvent(new CustomEvent('ochr:draw-area', { detail: { id: a.id } }));
  };
  sheet.querySelector('[data-reqdel]').onclick = async () => {
    closeOverlay();
    await requestDelete('areas', a, a.name);
  };
}

let importing = false;
async function runImport() {
  if (importing) return;
  importing = true;
  toast('Načítám chráněná území…');
  try {
    const added = await importProtectedAreas();
    toast(added ? `Přidáno ${added} území ✓` : 'Vše už je načteno', { ms: 3200 });
  } catch {
    toast('Import se nezdařil – zkus to online', { error: true });
  } finally {
    importing = false;
  }
}

function renderAreas(rawItems) {
  const host = $('#areas-section');
  if (!host) return;
  const seenSeed = new Set();
  const items = rawItems.filter((a) => {
    if (!a.seedId) return true;
    if (seenSeed.has(a.seedId)) return false;
    seenSeed.add(a.seedId);
    return true;
  });
  if (!items.length) {
    host.innerHTML = `
      <div class="card" style="border-left:4px solid var(--leaf)">
        <h3>🛡️ Chráněná území na mapě</h3>
        <div class="body" style="margin-top:6px">Načti oficiální hranice rezervací a Přírodního parku z AOPK ČR a založ lokální VKP/biocentra z Málkovy studie k zakreslení.</div>
        <div class="sheet-buttons" style="margin-top:10px"><button class="primary" id="areas-import" type="button">Načíst chráněná území</button></div>
      </div>
      <div class="list-divider" style="margin-top:14px">📚 Katalog ze studie ÚSES (náhled)</div>
      ${catalogHtml()}`;
    $('#areas-import').onclick = runImport;
    return;
  }
  const drawn = items.filter((a) => a.geometry).length;
  host.innerHTML =
    `<div class="list-divider" style="margin-top:6px">🛡️ Chráněná území · ${items.length} (${drawn} zakresleno)</div>
     <p class="login-foot" style="text-align:left;margin:0 2px 8px">Klepni na území pro úpravu. „Na mapě" otevře zákres hranice.</p>` +
    areasByType(items)
      .map(
        (g) => `
      <div class="list-divider">${g.meta.icon} ${g.meta.label} · ${g.items.length}</div>
      ${g.items
        .map((a) => {
          const status = a.geometry
            ? '<span class="pill money-in">✓ zakresleno</span>'
            : '<span class="pill money-out">▢ bez zákresu</span>';
          return `
          <div class="card" data-area="${a.id}" style="border-left:4px solid ${g.meta.color};cursor:pointer">
            <h3>${escapeHtml(a.name)} ${a._pending ? '<span class="pend">⏳</span>' : ''}</h3>
            <div class="meta" style="margin-top:6px">
              ${status}
              ${a.areaText ? `<span class="pill cat">${escapeHtml(a.areaText)}</span>` : ''}
              ${a.source === 'aopk' ? '<span class="pill author" style="background:#2e7d3220;color:#2e7d32">AOPK</span>' : ''}
              <span class="spacer"></span>
              <button class="btn-soft" data-map="${a.id}" type="button" style="min-height:32px;padding:0 12px">🗺️ Na mapě</button>
            </div>
            ${a.desc ? `<div class="body" style="margin-top:8px">${escapeHtml(a.desc)}</div>` : ''}
          </div>`;
        })
        .join('')}`
      )
      .join('');
  host.querySelectorAll('[data-map]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('ochr:draw-area', { detail: { id: b.dataset.map } }));
    };
  });
  host.querySelectorAll('[data-area]').forEach((card) => {
    card.onclick = () => {
      const a = items.find((x) => x.id === card.dataset.area);
      if (a) openAreaEdit(a);
    };
  });
}

// ---------- vlastní lokality ----------
function render(items) {
  const sub = $('#l-sub');
  if (sub) sub.textContent = `${LOCALITIES.length} spravovaných · ${items.length} vlastních`;
  const list = $('#loc-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML =
      `<div class="list-divider" style="margin-top:18px">➕ Vlastní lokality</div>` +
      `<p class="login-foot" style="text-align:left">Tady přidáš další místo mimo seznam výše – klepni na +.</p>`;
    return;
  }
  list.innerHTML =
    `<div class="list-divider" style="margin-top:18px">➕ Vlastní lokality · ${items.length}</div>` +
    items
      .map((l) => {
        const link = safeLink(l.link);
        return `
      <div class="card" style="border-left:4px solid ${userColor(l.author)}">
        <h3>${escapeHtml(l.name)} ${l._pending ? '<span class="pend">⏳</span>' : ''}</h3>
        ${l.place ? `<div class="meta"><span>📍 ${escapeHtml(l.place)}</span>${l.area ? `<span class="pill cat">${escapeHtml(l.area)}</span>` : ''}</div>` : ''}
        ${l.description ? `<div class="body" style="margin-top:8px">${escapeHtml(l.description)}</div>` : ''}
        <div class="meta" style="margin-top:8px">
          ${link ? `<a class="pill cat" href="${escapeHtml(link)}" target="_blank" rel="noopener">🌐 Odkaz</a>` : ''}
          ${authorChip(l.author)}
          <span>${escapeHtml(fmtDate(l.createdAt))}</span>
          <span class="spacer"></span>
          ${deleteButton(l)}
        </div>
      </div>`;
      })
      .join('');
  wireDeleteButtons(list, 'localities', (id) => items.find((x) => x.id === id), (l) => l.name || 'lokalita');
}

export const LocalitiesView = {
  collections: ['localities', 'areas'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Lokality ve správě</h2><div class="sub" id="l-sub">${LOCALITIES.length} spravovaných</div></div></div>
      <div id="areas-section"></div>
      <div id="loc-list"></div>
      <button class="fab" id="loc-add" type="button" aria-label="Nová lokalita">+</button>`;
    $('#loc-add').addEventListener('click', openForm);
    Store.subscribe('areas', renderAreas);
    Store.subscribe('localities', render);
  },
};
