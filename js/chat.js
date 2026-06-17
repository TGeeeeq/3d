// Týmový live chat – sdílené zprávy, polling, editace/mazání vlastních zpráv,
// upozornění (odznak na záložce + toast) všem ostatním na novou zprávu.
'use strict';
import { Store } from './store.js';
import { $, escapeHtml, userColor, getUser, fmtDateTime, toast, openSheet, closeOverlay, confirmSheet } from './ui.js';

let refreshTimer = null;

// ---------- vykreslení ----------
function render(items) {
  const list = $('#chat-list');
  if (!list) return;
  const me = getUser()?.name;
  const msgs = [...items].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.innerHTML = msgs.length
    ? msgs
        .map((m) => {
          const own = m.author === me;
          const c = userColor(m.author);
          const edited = m.updatedAt && m.updatedAt !== m.createdAt;
          return `<div class="chat-msg${own ? ' own' : ''}">
            <div class="chat-bubble"${own ? '' : ` style="border-left:3px solid ${c}"`}>
              ${own ? '' : `<div class="chat-author" style="color:${c}">${escapeHtml(m.author || '?')}</div>`}
              <div class="chat-text">${escapeHtml(m.text)}</div>
              <div class="chat-time">${escapeHtml(fmtDateTime(m.createdAt))}${edited ? ' · upraveno' : ''}${m._pending ? ' ⏳' : ''}</div>
              ${own ? `<div class="chat-acts"><button data-edit="${escapeHtml(m.id)}" type="button">Upravit</button><button data-del="${escapeHtml(m.id)}" type="button">Smazat</button></div>` : ''}
            </div>
          </div>`;
        })
        .join('')
    : `<div class="empty"><span class="big">💬</span>Zatím žádné zprávy. Napiš první!</div>`;
  if (atBottom || msgs.some((m) => m._pending)) list.scrollTop = list.scrollHeight;

  list.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => {
      const m = Store.get('chat').find((x) => x.id === b.dataset.edit);
      if (m) openEdit(m);
    };
  });
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tuto zprávu?', { okText: 'Smazat', danger: true }))) return;
      await Store.remove('chat', b.dataset.del); // server povolí jen autorovi
      toast('Smazáno');
    };
  });
}

function openEdit(m) {
  const sheet = openSheet(`
    <h2>Upravit zprávu</h2>
    <div class="field"><textarea id="chat-edit" rows="3" maxlength="500">${escapeHtml(m.text)}</textarea></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const text = sheet.querySelector('#chat-edit').value.trim();
    if (!text) {
      toast('Zpráva nesmí být prázdná');
      return;
    }
    closeOverlay();
    await Store.update('chat', m.id, { text });
    toast('Upraveno ✓');
  };
}

function send() {
  const inp = $('#chat-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  Store.add('chat', { text });
}

// ---------- upozornění na nové zprávy (pro všechny ostatní) ----------
const SEEN_KEY = 'ochr.chat.seen';
let lastSeen = '';
let lastToastTs = '';

const newest = (items) => items.reduce((mx, m) => ((m.createdAt || '') > mx ? m.createdAt || '' : mx), '');
const chatVisible = () => {
  const v = $('#view-chat');
  return v && !v.hidden;
};
function setBadge(n) {
  const b = $('#chat-badge');
  if (!b) return;
  if (n > 0) {
    b.textContent = n > 9 ? '9+' : String(n);
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

export function markChatSeen() {
  lastSeen = newest(Store.get('chat')) || new Date().toISOString();
  lastToastTs = lastSeen;
  try {
    localStorage.setItem(SEEN_KEY, lastSeen);
  } catch {
    /* ignore */
  }
  setBadge(0);
}

function chatNotify(items) {
  const me = getUser()?.name;
  if (chatVisible()) {
    markChatSeen();
    return;
  }
  const foreign = items.filter((m) => m.author !== me && (m.createdAt || '') > lastSeen);
  setBadge(foreign.length);
  const fresh = foreign
    .filter((m) => (m.createdAt || '') > lastToastTs)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  if (fresh.length) {
    const m = fresh[fresh.length - 1];
    toast(`💬 ${m.author || '?'}: ${m.text.slice(0, 40)}${m.text.length > 40 ? '…' : ''}`, { ms: 3800 });
    lastToastTs = newest(items);
  }
}

// Spustit jednou po přihlášení – sleduje chat na pozadí na všech záložkách.
export function initChatNotify() {
  try {
    lastSeen = localStorage.getItem(SEEN_KEY) || new Date().toISOString();
    localStorage.setItem(SEEN_KEY, lastSeen);
  } catch {
    lastSeen = new Date().toISOString();
  }
  lastToastTs = lastSeen;
  Store.subscribe('chat', chatNotify);
}

export const ChatView = {
  collections: ['chat'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div id="chat-list"></div>
      <div id="chat-bar">
        <input id="chat-input" type="text" placeholder="Napiš zprávu týmu…" maxlength="500" autocomplete="off" enterkeyhint="send">
        <button id="chat-send" type="button" aria-label="Odeslat">➤</button>
      </div>`;
    $('#chat-send').addEventListener('click', send);
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
    Store.subscribe('chat', render);
  },
  onShow() {
    markChatSeen();
    Store.refresh('chat').catch(() => {});
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => Store.refresh('chat').catch(() => {}), 5000);
    setTimeout(() => {
      const l = $('#chat-list');
      if (l) l.scrollTop = l.scrollHeight;
    }, 120);
  },
  onHide() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  },
};
