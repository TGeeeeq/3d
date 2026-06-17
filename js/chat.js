// Týmový live chat – sdílené zprávy s automatickým obnovováním (polling) když je chat otevřený.
'use strict';
import { Store } from './store.js';
import { $, escapeHtml, userColor, getUser, fmtDateTime, toast } from './ui.js';

let refreshTimer = null;

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
          return `<div class="chat-msg${own ? ' own' : ''}">
            <div class="chat-bubble"${own ? '' : ` style="border-left:3px solid ${c}"`}>
              ${own ? '' : `<div class="chat-author" style="color:${c}">${escapeHtml(m.author || '?')}</div>`}
              <div class="chat-text">${escapeHtml(m.text)}</div>
              <div class="chat-time">${escapeHtml(fmtDateTime(m.createdAt))}${m._pending ? ' ⏳' : ''}</div>
            </div>
          </div>`;
        })
        .join('')
    : `<div class="empty"><span class="big">💬</span>Zatím žádné zprávy. Napiš první!</div>`;
  if (atBottom || msgs.some((m) => m._pending)) list.scrollTop = list.scrollHeight;
}

function send() {
  const inp = $('#chat-input');
  const text = inp.value.trim();
  if (!text) return;
  if (text.length > 500) {
    toast('Zpráva je moc dlouhá');
    return;
  }
  inp.value = '';
  Store.add('chat', { text });
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
