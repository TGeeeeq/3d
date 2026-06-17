// Upozornění v appce: návrhy na smazání směrované konkrétnímu autorovi (zvoneček + panel).
'use strict';
import { Store } from './store.js';
import { $, openSheet, closeOverlay, toast, getUser, escapeHtml, confirmSheet } from './ui.js';

const COLL_LABEL = {
  notes: 'poznámku v mapě',
  diary: 'zápis v deníku',
  finance: 'finanční pohyb',
  time: 'záznam hodin',
  rewards: 'odměnu',
  localities: 'lokalitu',
  areas: 'chráněné území',
};

function mine() {
  const me = getUser()?.name;
  return Store.get('notifications').filter((n) => n.target === me && n.kind === 'delete_request');
}

function updateBadge() {
  const bell = $('#notif-bell');
  const count = $('#notif-count');
  if (!bell || !count) return;
  bell.hidden = false;
  const n = mine().length;
  if (n > 0) {
    count.textContent = n > 9 ? '9+' : String(n);
    count.hidden = false;
    bell.classList.add('has');
  } else {
    count.hidden = true;
    bell.classList.remove('has');
  }
}

function openPanel() {
  const items = mine();
  const body = items.length
    ? items
        .map(
          (n) => `
        <div class="card" data-n="${escapeHtml(n.id)}">
          <div class="body"><b>${escapeHtml(n.author || '?')}</b> navrhuje smazat ${escapeHtml(COLL_LABEL[n.collection] || 'položku')}${n.label ? ` „${escapeHtml(n.label)}"` : ''}.</div>
          <div class="sheet-buttons" style="margin-top:8px">
            <button class="danger" data-do="${escapeHtml(n.id)}" type="button">Smazat</button>
            <button class="secondary" data-keep="${escapeHtml(n.id)}" type="button">Ponechat</button>
          </div>
        </div>`
        )
        .join('')
    : `<p class="login-foot" style="text-align:left">Žádná upozornění. Když někdo navrhne smazat tvůj záznam, objeví se to tady.</p>`;
  const sheet = openSheet(`<h2>🔔 Upozornění</h2>${body}`);
  sheet.querySelectorAll('[data-do]').forEach((b) => {
    b.onclick = async () => {
      const n = mine().find((x) => x.id === b.dataset.do);
      if (!n) return;
      closeOverlay();
      if (!(await confirmSheet('Smazat svůj záznam?', { okText: 'Smazat', danger: true }))) return;
      try {
        await Store.remove(n.collection, n.recordId); // jsem autor → server povolí
      } catch {
        /* ignore */
      }
      await Store.remove('notifications', n.id);
      toast('Smazáno');
    };
  });
  sheet.querySelectorAll('[data-keep]').forEach((b) => {
    b.onclick = async () => {
      const n = mine().find((x) => x.id === b.dataset.keep);
      if (!n) return;
      await Store.remove('notifications', n.id); // adresát smí notifikaci zrušit
      toast('Ponecháno');
      closeOverlay();
    };
  });
}

export function initNotifications() {
  const bell = $('#notif-bell');
  if (bell) bell.onclick = openPanel;
  Store.subscribe('notifications', updateBadge);
}
