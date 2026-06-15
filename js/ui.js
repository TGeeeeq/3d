// Sdílené UI utility: toast, overlaye/sheety, DOM helpery, formátování.
'use strict';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

let toastTimer = null;
export function toast(msg, { ms = 2600, error = false } = {}) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, ms);
}

// ----- overlay / sheet systém -----
const backdrop = () => $('#backdrop');
let activeClose = null;

export function closeOverlay() {
  if (activeClose) {
    const fn = activeClose;
    activeClose = null;
    fn();
  }
  backdrop().hidden = true;
}

export function openOverlay(sheetEl, onClose) {
  closeOverlay();
  backdrop().hidden = false;
  sheetEl.hidden = false;
  activeClose = () => {
    sheetEl.hidden = true;
    if (onClose) onClose();
  };
}

// Vytvoří dočasný sheet z HTML, zobrazí ho a vrátí jeho element. Po zavření se odstraní.
export function openSheet(innerHtml) {
  const sheet = el(`<div class="sheet"><div class="sheet-handle"></div>${innerHtml}</div>`);
  $('#sheet-host').appendChild(sheet);
  openOverlay(sheet, () => sheet.remove());
  return sheet;
}

export function confirmSheet(message, { okText = 'Potvrdit', danger = false } = {}) {
  return new Promise((resolve) => {
    const sheet = openSheet(`
      <h2>${escapeHtml(message)}</h2>
      <div class="sheet-buttons">
        <button class="${danger ? 'danger' : 'primary'}" data-ok type="button">${escapeHtml(okText)}</button>
        <button class="secondary" data-cancel type="button">Zrušit</button>
      </div>`);
    sheet.querySelector('[data-ok]').onclick = () => {
      closeOverlay();
      resolve(true);
    };
    sheet.querySelector('[data-cancel]').onclick = () => {
      closeOverlay();
      resolve(false);
    };
  });
}

// backdrop klik zavírá
document.addEventListener('DOMContentLoaded', () => {
  backdrop().addEventListener('click', closeOverlay);
});

// ----- formátování -----
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) +
    ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}
export function fmtKc(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('cs-CZ') + ' Kč';
}
export function fmtHours(h) {
  const v = Number(h) || 0;
  return v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' h';
}
export function fmtDistance(m) {
  const v = Number(m) || 0;
  return v >= 1000 ? (v / 1000).toFixed(2) + ' km' : Math.round(v) + ' m';
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(s).padStart(2, '0');
}

// ----- aktuální uživatel -----
let _user = null;
export function setUser(u) { _user = u; }
export function getUser() { return _user; }

export function emptyState(icon, text) {
  return `<div class="empty"><span class="big">${icon}</span>${escapeHtml(text)}</div>`;
}
