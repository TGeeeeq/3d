// Hodiny: výkaz dobrovolnických hodin týmu. (Týmový přehled „kdo kolik odpracoval" je v sekci Peníze.)
'use strict';
import { Store } from './store.js';
import {
  $, $$, toast, openSheet, closeOverlay, escapeHtml, authorChip, userColor, fmtDate, fmtHours,
  confirmSheet, emptyState, getUser, micBtn, wireDictation,
} from './ui.js';

const FILTER_KEY = 'ochr.time.filter';
let filterMine = false;
try {
  filterMine = localStorage.getItem(FILTER_KEY) === 'mine';
} catch {
  /* ignore */
}
const todayISO = () => new Date().toISOString().slice(0, 10);

function openHoursForm() {
  const sheet = openSheet(`
    <h2>Zapsat hodiny</h2>
    <div class="field-row">
      <div class="field"><label>Datum</label><input id="h-date" type="date" value="${todayISO()}"></div>
      <div class="field"><label>Hodin</label><input id="h-hours" type="number" inputmode="decimal" min="0.5" step="0.5" value="2"></div>
    </div>
    <div class="field"><label>Činnost <span class="opt">(můžeš i nadiktovat 🎤)</span></label>
      <div class="ctrl inline"><input id="h-act" type="text" placeholder="např. sečení pcháče, výsadba, kravky" maxlength="120">${micBtn('#h-act')}</div></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  wireDictation(sheet);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const hours = parseFloat(sheet.querySelector('#h-hours').value);
    const date = sheet.querySelector('#h-date').value || todayISO();
    const activity = sheet.querySelector('#h-act').value.trim();
    if (!hours || hours <= 0) {
      toast('Zadej počet hodin');
      return;
    }
    closeOverlay();
    await Store.add('time', { hours, date, activity });
    toast('Hodiny zapsány ✓');
  };
}

function renderHours(items) {
  const me = getUser()?.name;
  const total = items.reduce((s, t) => s + (Number(t.hours) || 0), 0);
  const mine = items.filter((t) => t.author === me).reduce((s, t) => s + (Number(t.hours) || 0), 0);
  if ($('#h-total')) $('#h-total').textContent = fmtHours(total);
  if ($('#h-mine')) $('#h-mine').textContent = fmtHours(mine);

  const list = $('#hours-list');
  if (!list) return;
  const shown = filterMine ? items.filter((t) => t.author === me) : items;
  if (!shown.length) {
    list.innerHTML = emptyState('⏱️', 'Zatím žádné zapsané hodiny. Klepni na + a zapiš první.');
    return;
  }
  list.innerHTML = shown
    .map(
      (t) => `
    <div class="row-item" style="border-left:3px solid ${userColor(t.author)}">
      <span class="ri-ic">⏱️</span>
      <div class="ri-main">
        <div class="ri-title">${escapeHtml(t.activity || 'Práce v terénu')} ${t._pending ? '<span class="pend">⏳</span>' : ''}</div>
        <div class="ri-sub">${authorChip(t.author)} <span>${escapeHtml(fmtDate(t.date || t.createdAt))}</span></div>
      </div>
      <span class="ri-amount leaf">${escapeHtml(fmtHours(t.hours))}</span>
      <button class="icon-btn" data-del="${t.id}" type="button" aria-label="Smazat">✕</button>
    </div>`
    )
    .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tento záznam hodin?', { okText: 'Smazat', danger: true }))) return;
      await Store.remove('time', b.dataset.del);
      toast('Smazáno');
    };
  });
}

// Týmový přehled: kdo má kolik odpracovaných hodin (vodorovné pruhy, kompaktní).
function renderTeam(items) {
  const wrap = $('#team-hours');
  if (!wrap) return;
  const byAuthor = new Map();
  for (const t of items) {
    const a = t.author || '?';
    byAuthor.set(a, (byAuthor.get(a) || 0) + (Number(t.hours) || 0));
  }
  const rows = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    wrap.innerHTML = '';
    return;
  }
  const max = Math.max(...rows.map((r) => r[1]), 1);
  wrap.innerHTML = rows
    .map(([name, h]) => {
      const c = userColor(name);
      const pct = Math.max(6, Math.round((h / max) * 100));
      return `<div class="bar-row">
        <span class="bar-name" style="color:${c}">${escapeHtml(name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c}"></div></div>
        <span class="bar-val">${escapeHtml(fmtHours(h))}</span>
      </div>`;
    })
    .join('');
}

function setFilter(mine) {
  filterMine = mine;
  try {
    localStorage.setItem(FILTER_KEY, mine ? 'mine' : 'all');
  } catch {
    /* ignore */
  }
  $$('#view-time .seg-filter button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === mine));
  renderHours(Store.get('time'));
}

export const TimeView = {
  collections: ['time'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Hodiny</h2><div class="sub">Dobrovolnické hodiny týmu</div></div></div>
      <div class="stat-grid">
        <div class="stat"><div class="num leaf" id="h-total">0 h</div><div class="lbl">Tým celkem</div></div>
        <div class="stat"><div class="num" id="h-mine">0 h</div><div class="lbl">Moje hodiny</div></div>
      </div>
      <div class="list-divider">Kdo má kolik odpracováno</div>
      <div id="team-hours"></div>
      <div class="list-divider">Záznamy</div>
      <div class="seg seg-filter">
        <button data-f="all" class="active" type="button">👥 Vše</button>
        <button data-f="mine" type="button">🙋 Moje</button>
      </div>
      <div id="hours-list"></div>
      <button class="fab" id="fab-hours" type="button" aria-label="Zapsat hodiny">+</button>`;
    $$('#view-time .seg-filter button').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.f === 'mine')));
    $$('#view-time .seg-filter button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === filterMine));
    $('#fab-hours').addEventListener('click', openHoursForm);
    Store.subscribe('time', renderHours);
    Store.subscribe('time', renderTeam);
  },
};
