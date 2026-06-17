// Finance: příjmy a výdaje. Dvě sekce – týmové (vidí všichni) a osobní (vidí jen přihlášený).
'use strict';
import { Store } from './store.js';
import {
  $, $$, toast, openSheet, closeOverlay, escapeHtml, authorChip, userColor, fmtDate, fmtKc, confirmSheet, emptyState, getUser,
} from './ui.js';

const CATS = ['Materiál', 'Doprava', 'Nářadí', 'Dotace', 'Dar', 'Mzda', 'Občerstvení', 'Ostatní'];
const FILTER_KEY = 'ochr.finance.filter';
const PANEL_KEY = 'ochr.finance.panel';
let filterMine = false;
let panel = 'team';
try {
  filterMine = localStorage.getItem(FILTER_KEY) === 'mine';
  if (localStorage.getItem(PANEL_KEY) === 'personal') panel = 'personal';
} catch {
  /* ignore */
}
const todayISO = () => new Date().toISOString().slice(0, 10);
const isPersonal = (x) => x.scope === 'personal';

function openForm(scope) {
  const opts = CATS.map((c) => `<option value="${c}">${c}</option>`).join('');
  const sheet = openSheet(`
    <h2>${scope === 'personal' ? 'Nový osobní pohyb 🔒' : 'Nový týmový pohyb'}</h2>
    <div class="seg" id="f-type">
      <button data-type="out" class="active" type="button">➖ Výdaj</button>
      <button data-type="in" type="button">➕ Příjem</button>
    </div>
    <div class="field-row">
      <div class="field"><label>Částka (Kč)</label><input id="f-amount" type="number" inputmode="decimal" min="0" step="1" value=""></div>
      <div class="field"><label>Datum</label><input id="f-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field"><label>Kategorie</label><select id="f-cat">${opts}</select></div>
    <div class="field"><label>Popis</label><input id="f-note" type="text" placeholder="za co / od koho" maxlength="120"></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  let type = 'out';
  sheet.querySelectorAll('#f-type button').forEach((b) =>
    b.addEventListener('click', () => {
      type = b.dataset.type;
      sheet.querySelectorAll('#f-type button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    })
  );
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const amount = parseFloat(sheet.querySelector('#f-amount').value);
    if (!amount || amount <= 0) {
      toast('Zadej částku');
      return;
    }
    const data = {
      type,
      amount,
      category: sheet.querySelector('#f-cat').value,
      note: sheet.querySelector('#f-note').value.trim(),
      date: sheet.querySelector('#f-date').value || todayISO(),
      scope: scope === 'personal' ? 'personal' : 'team',
    };
    closeOverlay();
    await Store.add('finance', data);
    toast('Uloženo ✓');
  };
}

function fillStats(prefix, items) {
  const income = items.filter((x) => x.type === 'in').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const expense = items.filter((x) => x.type === 'out').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balance = income - expense;
  const bal = $(`#${prefix}-balance`);
  if (bal) {
    bal.textContent = fmtKc(balance);
    bal.className = 'num ' + (balance < 0 ? 'danger' : 'leaf');
  }
  if ($(`#${prefix}-in`)) $(`#${prefix}-in`).textContent = fmtKc(income);
  if ($(`#${prefix}-out`)) $(`#${prefix}-out`).textContent = fmtKc(expense);
}

function rowHtml(x) {
  const isIn = x.type === 'in';
  return `
    <div class="card" style="border-left:4px solid ${userColor(x.author)}">
      <div class="row between">
        <h3>${escapeHtml(x.note || x.category)} ${x._pending ? '<span class="pend">⏳</span>' : ''}</h3>
        <span class="num ${isIn ? 'leaf' : 'danger'}" style="font-size:18px;font-weight:800">${isIn ? '+' : '−'}${escapeHtml(fmtKc(x.amount))}</span>
      </div>
      <div class="meta">
        <span class="pill ${isIn ? 'money-in' : 'money-out'}">${escapeHtml(x.category || (isIn ? 'Příjem' : 'Výdaj'))}</span>
        ${authorChip(x.author)}
        <span>${escapeHtml(fmtDate(x.date || x.createdAt))}</span>
        <span class="spacer"></span>
        <button class="btn-ghost" data-del="${x.id}" type="button" style="min-height:32px;padding:0 12px">Smazat</button>
      </div>
    </div>`;
}

function bindDelete(list) {
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tento pohyb?', { okText: 'Smazat', danger: true }))) return;
      await Store.remove('finance', b.dataset.del);
      toast('Smazáno');
    };
  });
}

function render(items) {
  const me = getUser()?.name;
  const team = items.filter((x) => !isPersonal(x));
  const personal = items.filter((x) => isPersonal(x) && x.author === me);

  fillStats('f', filterMine ? team.filter((x) => x.author === me) : team);
  fillStats('fp', personal);

  const teamList = $('#fin-list');
  if (teamList) {
    const shown = filterMine ? team.filter((x) => x.author === me) : team;
    teamList.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : emptyState('💰', 'Žádné pohyby. Klepni na + a zaznamenej příjem nebo výdaj.');
    bindDelete(teamList);
  }

  const personalList = $('#fin-list-personal');
  if (personalList) {
    personalList.innerHTML = personal.length
      ? personal.map(rowHtml).join('')
      : emptyState('🔒', 'Tvoje osobní finance. Vidíš je jen ty. Mzdy z hodin se sem přičtou samy.');
    bindDelete(personalList);
  }
}

function setFilter(mine) {
  filterMine = mine;
  try {
    localStorage.setItem(FILTER_KEY, mine ? 'mine' : 'all');
  } catch {
    /* ignore */
  }
  $$('#view-finance .seg-filter button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === mine));
  render(Store.get('finance'));
}

function switchPanel(p) {
  panel = p;
  try {
    localStorage.setItem(PANEL_KEY, p);
  } catch {
    /* ignore */
  }
  $('#panel-team').hidden = p !== 'team';
  $('#panel-personal').hidden = p !== 'personal';
  $$('#view-finance .seg-main button').forEach((b) => b.classList.toggle('active', b.dataset.panel === p));
}

export const FinanceView = {
  collections: ['finance'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Finance</h2><div class="sub">Týmové i osobní příjmy a výdaje</div></div></div>
      <div class="seg seg-main">
        <button data-panel="team" class="active" type="button">🤝 Tým</button>
        <button data-panel="personal" type="button">👤 Osobní</button>
      </div>

      <div id="panel-team">
        <div class="stat" style="margin-bottom:10px"><div class="num leaf" id="f-balance">0 Kč</div><div class="lbl">Zůstatek týmu</div></div>
        <div class="stat-grid">
          <div class="stat"><div class="num leaf" id="f-in" style="font-size:18px">0 Kč</div><div class="lbl">Příjmy</div></div>
          <div class="stat"><div class="num danger" id="f-out" style="font-size:18px">0 Kč</div><div class="lbl">Výdaje</div></div>
        </div>
        <div class="seg seg-filter">
          <button data-f="all" class="active" type="button">👥 Vše</button>
          <button data-f="mine" type="button">🙋 Moje</button>
        </div>
        <div class="list-divider">Pohyby týmu</div>
        <div id="fin-list"></div>
      </div>

      <div id="panel-personal" hidden>
        <div class="stat" style="margin-bottom:10px"><div class="num leaf" id="fp-balance">0 Kč</div><div class="lbl">Můj zůstatek 🔒</div></div>
        <div class="stat-grid">
          <div class="stat"><div class="num leaf" id="fp-in" style="font-size:18px">0 Kč</div><div class="lbl">Příjmy (vč. mezd)</div></div>
          <div class="stat"><div class="num danger" id="fp-out" style="font-size:18px">0 Kč</div><div class="lbl">Výdaje</div></div>
        </div>
        <div class="list-divider">Moje pohyby (jen pro tebe)</div>
        <div id="fin-list-personal"></div>
      </div>

      <button class="fab" id="fin-add" type="button" aria-label="Nový pohyb">+</button>`;
    $$('#view-finance .seg-main button').forEach((b) => b.addEventListener('click', () => switchPanel(b.dataset.panel)));
    $$('#view-finance .seg-filter button').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.f === 'mine')));
    $$('#view-finance .seg-filter button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === filterMine));
    $('#fin-add').addEventListener('click', () => openForm(panel));
    switchPanel(panel);
    Store.subscribe('finance', render);
  },
};
