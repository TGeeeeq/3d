// Peníze: SOUKROMÝ přehled jednotlivce – výdělek z hodin (tajný režim) a vlastní výdaje.
// Vše je osobní: výdaje vidí jen autor, sazba i tajný režim jsou uložené pouze v zařízení.
'use strict';
import { Store } from './store.js';
import {
  $, $$, toast, openSheet, closeOverlay, escapeHtml, fmtDate, fmtKc, fmtHours,
  confirmSheet, emptyState, getUser, micBtn, wireDictation, lsGet, lsSet,
} from './ui.js';

// Rychlý výběr kategorií výdaje (terén = benzín, doprava, jídlo, nocleh, materiál…).
const EXPENSE_CATS = [
  { key: 'Benzín', icon: '⛽' },
  { key: 'Doprava', icon: '🚗' },
  { key: 'Jídlo', icon: '🍽️' },
  { key: 'Ubytování', icon: '🛏️' },
  { key: 'Materiál', icon: '🧰' },
  { key: 'Ostatní', icon: '🔧' },
];
const catIcon = (name) => (EXPENSE_CATS.find((c) => c.key === name) || EXPENSE_CATS[5]).icon;

const RATE_KEY = 'ochr.rate'; // Kč / hodina (soukromé, jen v zařízení)
const HIDE_KEY = 'ochr.money.hidden'; // '1' = tajný režim zapnutý (výchozí)

const getRate = () => Math.max(0, parseFloat(lsGet(RATE_KEY, '0')) || 0);
const isHidden = () => lsGet(HIDE_KEY, '1') !== '0';
const todayISO = () => new Date().toISOString().slice(0, 10);

// Částky jsou v tajném režimu rozmazané přes CSS (.money-card.blurred) – v DOM zůstávají reálné,
// odkrytí je tak okamžité klepnutím na oko.
const money = (n) => fmtKc(n);

function openRateForm() {
  const sheet = openSheet(`
    <h2>Moje hodinová sazba</h2>
    <p class="hint">Kolik si počítáš za hodinu práce. Uloží se jen v tomto zařízení – nikdo jiný ji nevidí.</p>
    <div class="field"><label>Sazba (Kč / hodina)</label>
      <input id="rate" type="number" inputmode="decimal" min="0" step="10" value="${getRate() || ''}" placeholder="např. 250"></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = () => {
    const v = Math.max(0, parseFloat(sheet.querySelector('#rate').value) || 0);
    lsSet(RATE_KEY, String(v));
    closeOverlay();
    renderAll();
    toast('Sazba uložena ✓');
  };
}

function openExpenseForm() {
  const chips = EXPENSE_CATS.map(
    (c, i) => `<button type="button" class="choice ${i === 0 ? 'selected' : ''}" data-cat="${c.key}">
      <span class="ic">${c.icon}</span><span class="nm">${c.key}</span></button>`
  ).join('');
  const sheet = openSheet(`
    <h2>Nový výdaj</h2>
    <div class="choice-grid compact" id="e-cats">${chips}</div>
    <div class="field-row">
      <div class="field"><label>Částka (Kč)</label><input id="e-amount" type="number" inputmode="decimal" min="0" step="1" placeholder="0"></div>
      <div class="field"><label>Datum</label><input id="e-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field"><label>Poznámka <span class="opt">(nepovinné)</span></label>
      <div class="ctrl inline"><input id="e-note" type="text" placeholder="za co" maxlength="120">${micBtn('#e-note')}</div></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit výdaj</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  let cat = EXPENSE_CATS[0].key;
  sheet.querySelectorAll('#e-cats .choice').forEach((b) =>
    b.addEventListener('click', () => {
      sheet.querySelectorAll('#e-cats .choice').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      cat = b.dataset.cat;
    })
  );
  wireDictation(sheet);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const amount = parseFloat(sheet.querySelector('#e-amount').value);
    if (!amount || amount <= 0) {
      toast('Zadej částku');
      return;
    }
    closeOverlay();
    await Store.add('finance', {
      type: 'out',
      amount,
      category: cat,
      note: sheet.querySelector('#e-note').value.trim(),
      date: sheet.querySelector('#e-date').value || todayISO(),
    });
    toast('Výdaj uložen ✓');
  };
}

function renderAll() {
  const me = getUser()?.name;
  const rate = getRate();
  const hidden = isHidden();

  const myHours = Store.get('time').filter((t) => t.author === me).reduce((s, t) => s + (Number(t.hours) || 0), 0);
  const earnings = myHours * rate;
  const myExpenses = Store.get('finance').filter((x) => x.author === me && x.type === 'out');
  const spent = myExpenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balance = earnings - spent;

  const eye = $('#m-eye');
  if (eye) {
    eye.textContent = hidden ? '🙈 Odkrýt' : '🙉 Skrýt';
    eye.classList.toggle('on', !hidden);
  }

  if ($('#m-balance')) {
    $('#m-balance').textContent = money(balance);
    $('#m-balance').className = 'num money-card ' + (balance < 0 ? 'danger' : 'leaf') + (hidden ? ' blurred' : '');
  }
  if ($('#m-earn')) $('#m-earn').textContent = money(earnings);
  if ($('#m-spent')) $('#m-spent').textContent = money(spent);
  $$('#view-finance .stat .money-card').forEach((c) => c.classList.toggle('blurred', hidden));
  if ($('#m-basis')) {
    if (!rate) {
      $('#m-basis').innerHTML = `<button class="linkish" id="m-rate" type="button">⚙️ Nastav si hodinovou sazbu</button>`;
    } else {
      const detail = hidden ? `z tvých ${fmtHours(myHours)}` : `${fmtHours(myHours)} × ${fmtKc(rate)}/h`;
      $('#m-basis').innerHTML = `${detail} &middot; <button class="linkish" id="m-rate" type="button">sazba</button>`;
    }
    const rb = $('#m-rate');
    if (rb) rb.onclick = openRateForm;
  }

  const list = $('#exp-list');
  if (!list) return;
  if (!myExpenses.length) {
    list.innerHTML = emptyState('🧾', 'Zatím žádné výdaje. Klepni na + a přidej třeba benzín nebo jídlo.');
    return;
  }
  list.innerHTML = myExpenses
    .map(
      (x) => `
      <div class="row-item">
        <span class="ri-ic">${catIcon(x.category)}</span>
        <div class="ri-main">
          <div class="ri-title">${escapeHtml(x.category || 'Výdaj')}${x.note ? ` <span class="ri-note">${escapeHtml(x.note)}</span>` : ''} ${x._pending ? '<span class="pend">⏳</span>' : ''}</div>
          <div class="ri-sub">${escapeHtml(fmtDate(x.date || x.createdAt))}</div>
        </div>
        <span class="ri-amount money-card ${hidden ? 'blurred' : ''}">−${money(x.amount)}</span>
        <button class="icon-btn" data-del="${x.id}" type="button" aria-label="Smazat">✕</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tento výdaj?', { okText: 'Smazat', danger: true }))) return;
      await Store.remove('finance', b.dataset.del);
      toast('Smazáno');
    };
  });
}

function toggleHidden() {
  lsSet(HIDE_KEY, isHidden() ? '0' : '1');
  renderAll();
}

export const FinanceView = {
  collections: ['finance', 'time'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head">
        <div><h2>Moje peníze</h2><div class="sub">Soukromý přehled – jen pro tebe</div></div>
        <button id="m-eye" class="eye-toggle" type="button">🙈 Odkrýt</button>
      </div>
      <div class="balance-card">
        <div class="num leaf money-card" id="m-balance">••• Kč</div>
        <div class="lbl">Zůstatek</div>
        <div class="basis" id="m-basis"></div>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="num leaf money-card" id="m-earn" style="font-size:19px">••• Kč</div><div class="lbl">Výdělek</div></div>
        <div class="stat"><div class="num danger money-card" id="m-spent" style="font-size:19px">••• Kč</div><div class="lbl">Výdaje</div></div>
      </div>
      <div class="list-divider">Moje výdaje</div>
      <div id="exp-list"></div>
      <button class="fab" id="exp-add" type="button" aria-label="Nový výdaj">+</button>`;
    $('#m-eye').addEventListener('click', toggleHidden);
    $('#exp-add').addEventListener('click', openExpenseForm);
    Store.subscribe('finance', renderAll);
    Store.subscribe('time', renderAll);
  },
};
