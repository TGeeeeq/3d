// Peníze: SOUKROMÝ přehled jednotlivce – osobní příjmy (mzda) a výdaje v TAJNÉM režimu.
// Navíc jediný „týmový" prvek: kompaktní graf odpracovaných hodin. Peníze zůstávají osobní.
'use strict';
import { Store } from './store.js';
import {
  $, $$, toast, openSheet, closeOverlay, escapeHtml, fmtDate, fmtKc, fmtHours,
  confirmSheet, emptyState, getUser, userColor, micBtn, wireDictation, lsGet, lsSet,
} from './ui.js';

// Druhy záznamu. Mzda je první – příjem počítaný ze sazby × hodin. Ostatní jsou výdaje.
const CATS = [
  { key: 'Mzda', icon: '💼', type: 'in' },
  { key: 'Benzín', icon: '⛽', type: 'out' },
  { key: 'Doprava', icon: '🚗', type: 'out' },
  { key: 'Jídlo', icon: '🍽️', type: 'out' },
  { key: 'Ubytování', icon: '🛏️', type: 'out' },
  { key: 'Materiál', icon: '🧰', type: 'out' },
  { key: 'Ostatní', icon: '🔧', type: 'out' },
];
const catOf = (name) => CATS.find((c) => c.key === name) || CATS[CATS.length - 1];

const RATE_KEY = 'ochr.rate'; // poslední použitá sazba (jen v zařízení – předvyplní se)
const HIDE_KEY = 'ochr.money.hidden'; // '1' = tajný režim zapnutý (výchozí)
const getRate = () => Math.max(0, parseFloat(lsGet(RATE_KEY, '0')) || 0);
const isHidden = () => lsGet(HIDE_KEY, '1') !== '0';
const todayISO = () => new Date().toISOString().slice(0, 10);

function openRecordForm() {
  const chips = CATS.map(
    (c, i) => `<button type="button" class="choice ${i === 0 ? 'selected' : ''}" data-cat="${c.key}">
      <span class="ic">${c.icon}</span><span class="nm">${c.key}</span></button>`
  ).join('');
  const sheet = openSheet(`
    <h2>Nový záznam</h2>
    <div class="choice-grid compact" id="r-cats">${chips}</div>
    <div id="r-wage">
      <div class="field-row">
        <div class="field"><label>Sazba (Kč / h)</label><input id="r-rate" type="number" inputmode="decimal" min="0" step="10" value="${getRate() || ''}" placeholder="250"></div>
        <div class="field"><label>Hodin</label><input id="r-hours" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0"></div>
      </div>
      <div class="calc-line">Vyděláno: <b id="r-calc">0 Kč</b></div>
    </div>
    <div id="r-exp" hidden>
      <div class="field"><label>Částka (Kč)</label><input id="r-amount" type="number" inputmode="decimal" min="0" step="1" placeholder="0"></div>
    </div>
    <div class="field"><label>Datum</label><input id="r-date" type="date" value="${todayISO()}"></div>
    <div class="field"><label>Poznámka <span class="opt">(nepovinné)</span></label>
      <div class="ctrl inline"><input id="r-note" type="text" placeholder="za co" maxlength="120">${micBtn('#r-note')}</div></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);

  let cat = CATS[0];
  const wage = sheet.querySelector('#r-wage');
  const exp = sheet.querySelector('#r-exp');
  const rateEl = sheet.querySelector('#r-rate');
  const hoursEl = sheet.querySelector('#r-hours');
  const calcEl = sheet.querySelector('#r-calc');
  const recalc = () => {
    calcEl.textContent = fmtKc((parseFloat(rateEl.value) || 0) * (parseFloat(hoursEl.value) || 0));
  };
  rateEl.addEventListener('input', recalc);
  hoursEl.addEventListener('input', recalc);

  sheet.querySelectorAll('#r-cats .choice').forEach((b) =>
    b.addEventListener('click', () => {
      sheet.querySelectorAll('#r-cats .choice').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      cat = catOf(b.dataset.cat);
      const isWage = cat.type === 'in';
      wage.hidden = !isWage;
      exp.hidden = isWage;
    })
  );
  wireDictation(sheet);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const date = sheet.querySelector('#r-date').value || todayISO();
    const note = sheet.querySelector('#r-note').value.trim();
    if (cat.type === 'in') {
      const rate = Math.max(0, parseFloat(rateEl.value) || 0);
      const hours = Math.max(0, parseFloat(hoursEl.value) || 0);
      if (!hours || !rate) {
        toast('Zadej sazbu i počet hodin');
        return;
      }
      lsSet(RATE_KEY, String(rate));
      closeOverlay();
      await Store.add('finance', { type: 'in', category: 'Mzda', amount: rate * hours, rate, hours, note, date });
      toast('Mzda uložena ✓');
    } else {
      const amount = parseFloat(sheet.querySelector('#r-amount').value);
      if (!amount || amount <= 0) {
        toast('Zadej částku');
        return;
      }
      closeOverlay();
      await Store.add('finance', { type: 'out', category: cat.key, amount, note, date });
      toast('Výdaj uložen ✓');
    }
  };
}

function renderMoney() {
  const me = getUser()?.name;
  const hidden = isHidden();
  const mine = Store.get('finance').filter((x) => x.author === me);
  const income = mine.filter((x) => x.type === 'in').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const spent = mine.filter((x) => x.type === 'out').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balance = income - spent;

  const eye = $('#m-eye');
  if (eye) {
    eye.textContent = hidden ? '🙈 Odkrýt' : '🙉 Skrýt';
    eye.classList.toggle('on', !hidden);
  }
  if ($('#m-balance')) {
    $('#m-balance').textContent = fmtKc(balance);
    $('#m-balance').className = 'num money-card ' + (balance < 0 ? 'danger' : 'leaf') + (hidden ? ' blurred' : '');
  }
  if ($('#m-in')) $('#m-in').textContent = fmtKc(income);
  if ($('#m-out')) $('#m-out').textContent = fmtKc(spent);
  $$('#view-finance .stat .money-card').forEach((c) => c.classList.toggle('blurred', hidden));

  const list = $('#rec-list');
  if (!list) return;
  if (!mine.length) {
    list.innerHTML = emptyState('🧾', 'Zatím nic. Klepni na + a přidej mzdu nebo výdaj.');
    return;
  }
  list.innerHTML = mine
    .map((x) => {
      const isIn = x.type === 'in';
      const c = catOf(x.category);
      return `
      <div class="row-item">
        <span class="ri-ic">${c.icon}</span>
        <div class="ri-main">
          <div class="ri-title">${escapeHtml(x.category || (isIn ? 'Příjem' : 'Výdaj'))}${x.note ? ` <span class="ri-note">${escapeHtml(x.note)}</span>` : ''} ${x._pending ? '<span class="pend">⏳</span>' : ''}</div>
          <div class="ri-sub">${escapeHtml(fmtDate(x.date || x.createdAt))}${isIn && x.hours ? ` · ${escapeHtml(fmtHours(x.hours))}` : ''}</div>
        </div>
        <span class="ri-amount money-card ${isIn ? 'leaf' : 'danger'} ${hidden ? 'blurred' : ''}">${isIn ? '+' : '−'}${fmtKc(x.amount)}</span>
        <button class="icon-btn" data-del="${x.id}" type="button" aria-label="Smazat">✕</button>
      </div>`;
    })
    .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tento záznam?', { okText: 'Smazat', danger: true }))) return;
      await Store.remove('finance', b.dataset.del);
      toast('Smazáno');
    };
  });
}

// Týmový přehled: kdo má kolik odpracovaných hodin (vodorovné pruhy, kompaktní).
function renderTeam() {
  const wrap = $('#team-hours');
  if (!wrap) return;
  const byAuthor = new Map();
  for (const t of Store.get('time')) {
    const a = t.author || '?';
    byAuthor.set(a, (byAuthor.get(a) || 0) + (Number(t.hours) || 0));
  }
  const rows = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty" style="padding:18px 10px">Zatím nikdo nezapsal hodiny.</div>`;
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

function toggleHidden() {
  lsSet(HIDE_KEY, isHidden() ? '0' : '1');
  renderMoney();
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
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="num leaf money-card" id="m-in" style="font-size:19px">••• Kč</div><div class="lbl">Příjmy</div></div>
        <div class="stat"><div class="num danger money-card" id="m-out" style="font-size:19px">••• Kč</div><div class="lbl">Výdaje</div></div>
      </div>
      <div class="list-divider">Moje příjmy a výdaje</div>
      <div id="rec-list"></div>
      <div class="list-divider">Tým · kdo má kolik odpracováno</div>
      <div id="team-hours"></div>
      <button class="fab" id="rec-add" type="button" aria-label="Nový záznam">+</button>`;
    $('#m-eye').addEventListener('click', toggleHidden);
    $('#rec-add').addEventListener('click', openRecordForm);
    Store.subscribe('finance', renderMoney);
    Store.subscribe('time', renderTeam);
  },
};
