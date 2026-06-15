// Finance: jednoduchý správce příjmů a výdajů týmu.
'use strict';
import { Store } from './store.js';
import {
  $, toast, openSheet, closeOverlay, escapeHtml, fmtDate, fmtKc, confirmSheet, emptyState,
} from './ui.js';

const CATS = ['Materiál', 'Doprava', 'Nářadí', 'Dotace', 'Dar', 'Občerstvení', 'Ostatní'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function openForm() {
  const opts = CATS.map((c) => `<option value="${c}">${c}</option>`).join('');
  const sheet = openSheet(`
    <h2>Nový pohyb</h2>
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
    };
    closeOverlay();
    try {
      await Store.add('finance', data);
      toast('Uloženo ✓');
    } catch {
      toast('Uložení selhalo', { error: true });
    }
  };
}

function render(items) {
  const income = items.filter((x) => x.type === 'in').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const expense = items.filter((x) => x.type === 'out').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balance = income - expense;
  if ($('#f-balance')) {
    $('#f-balance').textContent = fmtKc(balance);
    $('#f-balance').className = 'num ' + (balance < 0 ? 'danger' : 'leaf');
  }
  if ($('#f-in')) $('#f-in').textContent = fmtKc(income);
  if ($('#f-out')) $('#f-out').textContent = fmtKc(expense);

  const list = $('#fin-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = emptyState('💰', 'Žádné pohyby. Klepni na + a zaznamenej příjem nebo výdaj.');
    return;
  }
  list.innerHTML = items
    .map((x) => {
      const isIn = x.type === 'in';
      return `
      <div class="card">
        <div class="row between">
          <h3>${escapeHtml(x.note || x.category)}</h3>
          <span class="num ${isIn ? 'leaf' : 'danger'}" style="font-size:18px;font-weight:800">${isIn ? '+' : '−'}${escapeHtml(fmtKc(x.amount))}</span>
        </div>
        <div class="meta">
          <span class="pill ${isIn ? 'money-in' : 'money-out'}">${escapeHtml(x.category || (isIn ? 'Příjem' : 'Výdaj'))}</span>
          <span class="pill author">${escapeHtml(x.author || '?')}</span>
          <span>${escapeHtml(fmtDate(x.date || x.createdAt))}</span>
          <span class="spacer"></span>
          <button class="btn-ghost" data-del="${x.id}" type="button" style="min-height:32px;padding:0 12px">Smazat</button>
        </div>
      </div>`;
    })
    .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tento pohyb?', { okText: 'Smazat', danger: true }))) return;
      try {
        await Store.remove('finance', b.dataset.del);
        toast('Smazáno');
      } catch {
        toast('Smazání selhalo', { error: true });
      }
    };
  });
}

export const FinanceView = {
  collections: ['finance'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Finance</h2><div class="sub">Příjmy a výdaje týmu</div></div></div>
      <div class="stat" style="margin-bottom:10px"><div class="num leaf" id="f-balance">0 Kč</div><div class="lbl">Zůstatek</div></div>
      <div class="stat-grid">
        <div class="stat"><div class="num leaf" id="f-in" style="font-size:18px">0 Kč</div><div class="lbl">Příjmy</div></div>
        <div class="stat"><div class="num danger" id="f-out" style="font-size:18px">0 Kč</div><div class="lbl">Výdaje</div></div>
      </div>
      <div class="list-divider">Pohyby</div>
      <div id="fin-list"></div>
      <button class="fab" id="fin-add" type="button" aria-label="Nový pohyb">+</button>`;
    $('#fin-add').addEventListener('click', openForm);
    Store.subscribe('finance', render);
  },
};
