// Lokality ve správě – oficiální katalog (ÚSES Karel Málek) + ručně přidané lokality.
'use strict';
import { Store } from './store.js';
import {
  $, toast, openSheet, closeOverlay, escapeHtml, authorChip, userColor, fmtDate, confirmSheet,
} from './ui.js';
import { LOCALITIES, localitiesByType } from './localities-data.js';

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

// Oficiální katalog spravovaných lokalit (statický, jen ke čtení).
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

// Ručně přidané lokality (mimo oficiální seznam).
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
          <button class="btn-ghost" data-del="${l.id}" type="button" style="min-height:32px;padding:0 12px">Smazat</button>
        </div>
      </div>`;
      })
      .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tuto lokalitu?', { okText: 'Smazat', danger: true }))) return;
      try {
        await Store.remove('localities', b.dataset.del);
        toast('Smazáno');
      } catch {
        toast('Smazání selhalo', { error: true });
      }
    };
  });
}

export const LocalitiesView = {
  collections: ['localities'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Lokality ve správě</h2><div class="sub" id="l-sub">${LOCALITIES.length} spravovaných</div></div></div>
      <div class="list-divider" style="margin-top:6px">🗺️ Spravované lokality ČSOP</div>
      <p class="login-foot" style="text-align:left;margin:0 2px 6px">Místa ze studie ÚSES Karla Málka. Při zápisu do mapy je vyber v poli „Lokalita".</p>
      <div id="loc-official"></div>
      <div id="loc-list"></div>
      <button class="fab" id="loc-add" type="button" aria-label="Nová lokalita">+</button>`;
    $('#loc-official').innerHTML = catalogHtml();
    $('#loc-add').addEventListener('click', openForm);
    Store.subscribe('localities', render);
  },
};
