// Hodiny: výkaz dobrovolnických hodin + odměny (body za odpracovaný čas).
'use strict';
import { Store } from './store.js';
import {
  $, $$, toast, openSheet, closeOverlay, escapeHtml, authorChip, userColor, fmtDate, fmtHours, fmtKc, confirmSheet, emptyState, getUser,
} from './ui.js';
import { deleteButton, wireDeleteButtons } from './actions.js';

const POINTS_PER_HOUR = 10;
const ACTIVITIES = ['Hrabání', 'Sekání', 'Odvoz', 'Rudoltička'];
const WAGE_KEY = 'ochr.time.wage';
const FILTER_KEY = 'ochr.time.filter';
let filterMine = false;
try {
  filterMine = localStorage.getItem(FILTER_KEY) === 'mine';
} catch {
  /* ignore */
}
const todayISO = () => new Date().toISOString().slice(0, 10);

function openHoursForm() {
  let lastWage = '';
  try {
    lastWage = localStorage.getItem(WAGE_KEY) || '';
  } catch {
    /* ignore */
  }
  const actOpts = ACTIVITIES.map((a) => `<option value="${a}">${a}</option>`).join('');
  const sheet = openSheet(`
    <h2>Zapsat hodiny</h2>
    <div class="field"><label>Datum</label><input id="h-date" type="date" value="${todayISO()}"></div>
    <div class="field-row">
      <div class="field"><label>Hodin</label><input id="h-hours" type="number" inputmode="decimal" min="0.5" step="0.5" value="2"></div>
    </div>
    <div class="field"><label>Činnost</label>
      <select id="h-act-sel">${actOpts}<option value="__other">Jiné…</option></select>
    </div>
    <div class="field" id="h-act-other-wrap" hidden>
      <label>Jiná činnost</label>
      <input id="h-act" type="text" placeholder="např. výsadba, monitoring, kravky" maxlength="120">
    </div>
    <div class="field">
      <label>Hodinová mzda <span style="font-weight:500;color:var(--muted)">(Kč/h, nepovinné)</span></label>
      <input id="h-wage" type="number" inputmode="decimal" min="0" step="10" value="${escapeHtml(lastWage)}" placeholder="0">
      <div id="h-wage-calc" class="sub" style="margin-top:6px;color:var(--muted)"></div>
    </div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);

  const sel = sheet.querySelector('#h-act-sel');
  const otherWrap = sheet.querySelector('#h-act-other-wrap');
  const otherInput = sheet.querySelector('#h-act');
  sel.addEventListener('change', () => {
    otherWrap.hidden = sel.value !== '__other';
    if (sel.value === '__other') otherInput.focus();
  });

  const hoursEl = sheet.querySelector('#h-hours');
  const wageEl = sheet.querySelector('#h-wage');
  const calcEl = sheet.querySelector('#h-wage-calc');
  const updateCalc = () => {
    const h = parseFloat(hoursEl.value) || 0;
    const w = parseFloat(wageEl.value) || 0;
    calcEl.textContent = w > 0 ? `➕ Do osobních financí: ${fmtKc(h * w)}` : '';
  };
  hoursEl.addEventListener('input', updateCalc);
  wageEl.addEventListener('input', updateCalc);
  updateCalc();

  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const hours = parseFloat(hoursEl.value);
    const date = sheet.querySelector('#h-date').value || todayISO();
    const activity = sel.value === '__other' ? otherInput.value.trim() : sel.value;
    const wage = parseFloat(wageEl.value) || 0;
    if (!hours || hours <= 0) {
      toast('Zadej počet hodin');
      return;
    }
    if (sel.value === '__other' && !activity) {
      toast('Zadej název činnosti');
      return;
    }
    try {
      localStorage.setItem(WAGE_KEY, wage > 0 ? String(wage) : '');
    } catch {
      /* ignore */
    }
    closeOverlay();
    // Záznam hodin je SDÍLENÝ – proto na něj sazbu NEUKLÁDÁME, ať nikdo nevidí cizí sazbu.
    await Store.add('time', { hours, date, activity });
    // Sazba se použije jen k výpočtu OSOBNÍ finance (scope personal – vidí ji jen přihlášený).
    if (wage > 0) {
      await Store.add('finance', {
        scope: 'personal',
        type: 'in',
        amount: hours * wage,
        category: 'Mzda',
        note: `${activity || 'Práce v terénu'} – ${fmtHours(hours)} × ${fmtKc(wage)}/h`,
        date,
      });
      toast(`Hodiny i mzda ${fmtKc(hours * wage)} zapsány ✓`, { ms: 3200 });
    } else {
      toast('Hodiny zapsány ✓');
    }
  };
}

function openRewardForm() {
  const sheet = openSheet(`
    <h2>Nová odměna</h2>
    <div class="field"><label>Název odměny</label><input id="r-title" type="text" placeholder="např. Týmová večeře" maxlength="80"></div>
    <div class="field"><label>Cena v bodech</label><input id="r-cost" type="number" inputmode="numeric" min="0" step="10" value="100"></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Přidat</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const title = sheet.querySelector('#r-title').value.trim();
    const cost = parseInt(sheet.querySelector('#r-cost').value, 10) || 0;
    if (!title) {
      toast('Zadej název');
      return;
    }
    closeOverlay();
    await Store.add('rewards', { title, cost, claimedBy: null, claimedAt: null });
    toast('Odměna přidána ✓');
  };
}

function renderHours(items) {
  const me = getUser()?.name;
  const total = items.reduce((s, t) => s + (Number(t.hours) || 0), 0);
  const mine = items.filter((t) => t.author === me).reduce((s, t) => s + (Number(t.hours) || 0), 0);
  if ($('#h-total')) $('#h-total').textContent = fmtHours(total);
  if ($('#h-mine')) $('#h-mine').textContent = fmtHours(mine);
  if ($('#r-points')) $('#r-points').textContent = Math.round(total * POINTS_PER_HOUR);

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
    <div class="card" style="border-left:4px solid ${userColor(t.author)}">
      <div class="row between">
        <h3>${escapeHtml(t.activity || 'Práce v terénu')} ${t._pending ? '<span class="pend">⏳</span>' : ''}</h3>
        <span class="num leaf" style="font-size:18px;font-weight:800">${escapeHtml(fmtHours(t.hours))}</span>
      </div>
      <div class="meta">
        ${authorChip(t.author)}
        <span>${escapeHtml(fmtDate(t.date || t.createdAt))}</span>
        <span class="spacer"></span>
        ${deleteButton(t)}
      </div>
    </div>`
    )
    .join('');
  wireDeleteButtons(list, 'time', (id) => Store.get('time').find((x) => x.id === id), (t) => t.activity || 'záznam hodin');
}

function renderRewards(items) {
  const list = $('#rewards-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = emptyState('🏅', 'Žádné odměny. Přidej cíl, na který tým společně „sbírá“ body.');
    return;
  }
  list.innerHTML = items
    .map((r) => {
      const claimed = !!r.claimedBy;
      return `
      <div class="card" style="${claimed ? 'opacity:.7' : ''}">
        <div class="row between">
          <h3>${escapeHtml(r.title)} ${r._pending ? '<span class="pend">⏳</span>' : ''}</h3>
          <span class="pill cat">${escapeHtml(String(r.cost))} b</span>
        </div>
        <div class="meta">
          ${claimed
            ? `<span>✅ Získal(a): ${authorChip(r.claimedBy)}</span>`
            : `<button class="btn-soft" data-claim="${r.id}" type="button" style="min-height:36px;padding:0 14px">Označit jako získané</button>`}
          <span class="spacer"></span>
          ${deleteButton(r)}
        </div>
      </div>`;
    })
    .join('');
  list.querySelectorAll('[data-claim]').forEach((b) => {
    b.onclick = async () => {
      await Store.update('rewards', b.dataset.claim, { claimedBy: getUser()?.name || '?', claimedAt: new Date().toISOString() });
      toast('Odměna získána 🎉');
    };
  });
  wireDeleteButtons(list, 'rewards', (id) => Store.get('rewards').find((x) => x.id === id), (r) => r.title || 'odměna');
}

function switchPanel(panel) {
  $('#panel-hours').hidden = panel !== 'hours';
  $('#panel-rewards').hidden = panel !== 'rewards';
  $('#fab-hours').hidden = panel !== 'hours';
  $('#fab-rewards').hidden = panel !== 'rewards';
  $$('#view-time .seg-main button').forEach((b) => b.classList.toggle('active', b.dataset.panel === panel));
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

// Jednorázové pročištění: vynuluje sazbu na MÝCH starších sdílených záznamech hodin
// (sazba se dřív krátce ukládala na sdílený záznam). Každý člen si tím pročistí své.
let wageScrubbed = false;
async function scrubMyWages() {
  if (wageScrubbed) return;
  wageScrubbed = true;
  try {
    await Store.refresh('time');
  } catch {
    /* offline – pročistí se z lokální cache */
  }
  const me = getUser()?.name;
  for (const t of Store.get('time')) {
    if (t.author === me && Number(t.wage) > 0) Store.update('time', t.id, { wage: 0 });
  }
}

export const TimeView = {
  collections: ['time', 'rewards'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Hodiny &amp; odměny</h2><div class="sub">Dobrovolnické hodiny týmu a body za práci</div></div></div>
      <div class="stat-grid">
        <div class="stat"><div class="num leaf" id="h-total">0 h</div><div class="lbl">Tým celkem</div></div>
        <div class="stat"><div class="num" id="h-mine">0 h</div><div class="lbl">Moje hodiny</div></div>
      </div>
      <div class="seg seg-main">
        <button data-panel="hours" class="active" type="button">⏱️ Hodiny</button>
        <button data-panel="rewards" type="button">🏅 Odměny</button>
      </div>
      <div id="panel-hours">
        <div class="seg seg-filter">
          <button data-f="all" class="active" type="button">👥 Vše</button>
          <button data-f="mine" type="button">🙋 Moje</button>
        </div>
        <div id="hours-list"></div>
      </div>
      <div id="panel-rewards" hidden>
        <div class="stat" style="margin-bottom:12px"><div class="num" id="r-points" style="color:var(--sun);text-shadow:0 1px 0 #c9a800">0</div><div class="lbl">Bodů týmu (10 b / hodina)</div></div>
        <div id="rewards-list"></div>
      </div>
      <button class="fab" id="fab-hours" type="button" aria-label="Zapsat hodiny">+</button>
      <button class="fab" id="fab-rewards" type="button" aria-label="Nová odměna" hidden>+</button>`;
    $$('#view-time .seg-main button').forEach((b) => b.addEventListener('click', () => switchPanel(b.dataset.panel)));
    $$('#view-time .seg-filter button').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.f === 'mine')));
    $$('#view-time .seg-filter button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === filterMine));
    $('#fab-hours').addEventListener('click', openHoursForm);
    $('#fab-rewards').addEventListener('click', openRewardForm);
    Store.subscribe('time', renderHours);
    Store.subscribe('rewards', renderRewards);
    switchPanel('hours');
    scrubMyWages();
  },
};
