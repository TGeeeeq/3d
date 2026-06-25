// Orchestrátor terénní aplikace ČSOP Trosečníci.
'use strict';
import { Api } from './api.js';
import { Store, setLiveCollections, startSync, stopSync, onPending } from './store.js';
import { $, $$, toast, openOverlay, closeOverlay, setUser, openSheet, escapeHtml } from './ui.js';
import { MapView } from './map.js';
import { TrackView, recoverTrackDraft } from './track.js';
import { DiaryView } from './diary.js';
import { TimeView } from './time.js';
import { FinanceView } from './finance.js';
import { LocalitiesView } from './localities.js';
import { ChatView, initChatNotify } from './chat.js';
import { initNotifications } from './notifications.js';

const VIEWS = {
  map: MapView,
  track: TrackView,
  diary: DiaryView,
  time: TimeView,
  finance: FinanceView,
  localities: LocalitiesView,
  chat: ChatView,
};

let currentTab = null;

// ---- velikost písma (přístupnost) ----
const FONT_KEY = 'ochr.fontsize';
function applyFontSize(level) {
  document.body.classList.remove('fs-1', 'fs-2');
  if (level === '1') document.body.classList.add('fs-1');
  else if (level === '2') document.body.classList.add('fs-2');
  document.querySelectorAll('#fontsize-seg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.fs === (level || '0'))
  );
}
function initFontSize() {
  let level = '0';
  try {
    level = localStorage.getItem(FONT_KEY) || '0';
  } catch {
    /* ignore */
  }
  applyFontSize(level);
}

function showTab(tab) {
  const view = VIEWS[tab];
  if (!view || currentTab === tab) return;

  if (currentTab) {
    $(`#view-${currentTab}`).hidden = true;
    document.querySelector(`.tab[data-tab="${currentTab}"]`)?.classList.remove('active');
    VIEWS[currentTab].onHide?.();
  }

  const viewEl = $(`#view-${tab}`);
  viewEl.hidden = false;
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add('active');
  if (!view._mounted) {
    view.mount(viewEl);
    view._mounted = true;
  }
  currentTab = tab;
  // notifikace + chat pollujeme vždy (zvoneček a upozornění na zprávy fungují na všech záložkách)
  setLiveCollections([...(view.collections || []), 'notifications', 'chat']);
  view.onShow?.();
  try {
    localStorage.setItem('ochr.tab', tab);
  } catch {
    /* ignore */
  }
}

let pendingWired = false;
function wirePendingBadge() {
  if (pendingWired) return;
  pendingWired = true;
  const badge = document.createElement('span');
  badge.id = 'pending-badge';
  badge.hidden = true;
  $('#user-chip').insertAdjacentElement('beforebegin', badge);
  let clearT = null;
  onPending((n) => {
    if (n > 0) {
      badge.textContent = `⏳ ${n}`;
      badge.className = '';
      badge.hidden = false;
      if (clearT) clearTimeout(clearT);
    } else if (!badge.hidden) {
      badge.textContent = '✓ uloženo';
      badge.className = 'ok';
      if (clearT) clearTimeout(clearT);
      clearT = setTimeout(() => {
        badge.hidden = true;
      }, 2000);
    }
  });
}

function enterApp(user) {
  setUser(user);
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  $('#user-name').textContent = user.name;
  wirePendingBadge();
  initNotifications();
  initChatNotify();
  startSync(20000);
  recoverTrackDraft(); // obnoví rozdělanou trasu hned po startu, ať se neztratí
  const last = localStorage.getItem('ochr.tab');
  showTab(VIEWS[last] ? last : 'map');
}

function showLogin() {
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  stopSync();
}

function wireLogin() {
  const form = $('#login-form');
  const errEl = $('#login-error');
  const nameWrap = $('#login-name-wrap');
  const nameInput = $('#login-name');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const code = $('#login-code').value;
    const name = nameWrap.hidden ? '' : nameInput.value.trim();
    const btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Přihlašuji…';
    try {
      const user = await Api.login(code, name);
      try {
        if (user && user.name) localStorage.setItem('ochr.name', user.name);
      } catch {
        /* ignore */
      }
      enterApp(user);
    } catch (err) {
      if (err.message === 'name_required') {
        // záložní týmový kód – appka ještě potřebuje jméno
        nameWrap.hidden = false;
        try {
          const saved = localStorage.getItem('ochr.name');
          if (saved && !nameInput.value) nameInput.value = saved;
        } catch {
          /* ignore */
        }
        nameInput.focus();
        errEl.textContent = 'Týmový kód: napiš ještě své jméno a potvrď.';
      } else {
        errEl.textContent =
          err.message === 'bad_code' ? 'Neplatné heslo.' : 'Přihlášení se nezdařilo. Zkus to znovu.';
      }
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Vstoupit';
    }
  });
}

function wireTabs() {
  document.querySelectorAll('#tabbar .tab').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab))
  );
  // Ze seznamu Lokality: „Zakreslit / Na mapě" – přepni na mapu a zaměř/kresli území.
  window.addEventListener('ochr:draw-area', (e) => {
    const id = e.detail && e.detail.id;
    showTab('map');
    setTimeout(() => MapView.focusArea?.(id), 180);
  });
}

// Diagnostika: zjistí, zda jsme přihlášení a kolik záznamů server vrací v každé kolekci.
// Čistě čtení – nic nemaže ani nemění. Slouží k dohledání „zmizelých" dat.
async function runDiagnostics() {
  closeOverlay();
  const sheet = openSheet(
    `<h2>🔧 Diagnostika dat</h2>
     <div id="diag-body"><p style="color:var(--muted)">Zjišťuji…</p></div>
     <div class="sheet-buttons"><button class="secondary" data-close type="button">Zavřít</button></div>`
  );
  sheet.querySelector('[data-close]').onclick = closeOverlay;
  const body = sheet.querySelector('#diag-body');

  let who = '—';
  try {
    const u = await Api.me();
    who = u && u.name ? u.name : '— (přihlášen, bez jména)';
  } catch (e) {
    who = 'NEPŘIHLÁŠEN' + (e && e.status ? ' (' + e.status + ')' : '');
  }

  const cols = [
    ['notes', 'Mapa – značky/plochy'],
    ['diary', 'Deník'],
    ['finance', 'Peníze'],
    ['time', 'Hodiny'],
    ['localities', 'Lokality'],
    ['tracks', 'Trasy'],
    ['areas', 'Chráněná území'],
  ];
  let totalServer = 0;
  const rows = [];
  for (const [c, label] of cols) {
    let val;
    try {
      const items = await Api.list(c);
      totalServer += items.length;
      val = `<b>${items.length}</b>`;
    } catch (e) {
      const msg = e && e.message ? String(e.message).slice(0, 80) : '';
      val = `<b style="color:var(--danger)">chyba ${e && e.status ? e.status : ''}</b><div style="color:var(--danger);font-size:11px;max-width:170px;word-break:break-word">${escapeHtml(msg)}</div>`;
    }
    const local = Store.get(c).length;
    rows.push(
      `<div class="row between" style="padding:4px 0"><span>${label}</span><span>${val} <span style="color:var(--muted);font-size:12px">(v telefonu ${local})</span></span></div>`
    );
  }

  body.innerHTML = `
    <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line);margin-bottom:8px">
      <span>Přihlášen jako</span><b>${escapeHtml(who)}</b>
    </div>
    ${rows.join('')}
    <p style="color:var(--muted);font-size:13px;line-height:1.45;margin-top:10px">
      Číslo = kolik záznamů vrací <b>server</b>; v závorce kolik jich máš uložených v telefonu.
      ${totalServer === 0 ? 'Server vrací 0 – data nejsou v aktuálním úložišti (jiné/prázdné úložiště nebo odhlášení).' : 'Server data má – pokud je v appce nevidíš, je to chyba zobrazení a opravím ji.'}
      Pošli mi prosím tento výpis (klidně screenshot).
    </p>`;
}

// Jednorázové zpřístupnění dat: převede uložené záznamy/média na veřejně čitelné.
// Jde po jedné kolekci (kvůli časovému limitu) a ukazuje průběh.
async function restoreData() {
  closeOverlay();
  const sheet = openSheet(
    `<h2>🛟 Obnovit moje data</h2>
     <p style="color:var(--muted);font-size:13px;line-height:1.45">Převedu uložené záznamy na čitelné. Nech appku otevřenou, chvíli to potrvá.</p>
     <div id="restore-body"></div>
     <div class="sheet-buttons"><button class="secondary" data-close type="button" disabled>Probíhá…</button></div>`
  );
  const body = sheet.querySelector('#restore-body');
  const closeBtn = sheet.querySelector('[data-close]');
  const targets = [
    ['notes', 'Mapa – značky/plochy'],
    ['diary', 'Deník'],
    ['finance', 'Peníze'],
    ['time', 'Hodiny'],
    ['rewards', 'Odměny'],
    ['localities', 'Lokality'],
    ['tracks', 'Trasy'],
    ['areas', 'Chráněná území'],
    ['media', 'Fotky a hlas'],
  ];
  let totalCopied = 0;
  for (const [c, label] of targets) {
    const row = document.createElement('div');
    row.className = 'row between';
    row.style.padding = '4px 0';
    row.innerHTML = `<span>${label}</span><b>…</b>`;
    body.appendChild(row);
    try {
      const r = await Api.migratePublic(c);
      totalCopied += r.copied || 0;
      row.querySelector('b').innerHTML = r.errors
        ? `${r.copied}/${r.total} <span style="color:var(--danger);font-size:11px">(${r.errors} chyb)${r.firstError ? `<br>${escapeHtml(String(r.firstError).slice(0, 70))}` : ''}</span>`
        : `${r.copied}/${r.total} ✓`;
    } catch (e) {
      row.querySelector('b').innerHTML = `<span style="color:var(--danger)">chyba ${e && e.status ? e.status : ''}</span>`;
    }
  }
  const note = document.createElement('p');
  note.style.cssText = 'font-size:13px;line-height:1.45;margin-top:10px';
  note.innerHTML = `Hotovo – převedeno ${totalCopied} položek. Teď načtu data znovu.`;
  body.appendChild(note);
  closeBtn.disabled = false;
  closeBtn.textContent = 'Zavřít';
  closeBtn.onclick = closeOverlay;
  // znovu načti vše ze serveru
  await Promise.all(
    ['notes', 'tracks', 'diary', 'time', 'finance', 'rewards', 'localities', 'areas', 'chat', 'notifications'].map((c) =>
      Store.refresh(c).catch(() => {})
    )
  );
  toast('Data načtena ✓');
}

function wireMenus() {
  $('#user-chip').addEventListener('click', () => openOverlay($('#app-menu')));
  $('#btn-app-menu-close').addEventListener('click', closeOverlay);
  document.querySelectorAll('#fontsize-seg button').forEach((b) =>
    b.addEventListener('click', () => {
      try {
        localStorage.setItem(FONT_KEY, b.dataset.fs);
      } catch {
        /* ignore */
      }
      applyFontSize(b.dataset.fs);
      toast('Velikost písma upravena');
    })
  );
  $('#btn-localities').addEventListener('click', () => {
    closeOverlay();
    showTab('localities');
  });
  $('#btn-refresh-all').addEventListener('click', async () => {
    closeOverlay();
    toast('Načítám data…');
    await Promise.all(
      ['notes', 'tracks', 'diary', 'time', 'finance', 'rewards', 'localities', 'areas', 'chat', 'notifications'].map((c) =>
        Store.refresh(c).catch(() => {})
      )
    );
    toast('Hotovo ✓');
  });
  $('#btn-diag').addEventListener('click', runDiagnostics);
  $('#btn-restore').addEventListener('click', restoreData);
  $('#btn-logout').addEventListener('click', async () => {
    closeOverlay();
    try {
      await Api.logout();
    } catch {
      /* ignore */
    }
    showLogin();
  });
}

async function boot() {
  initFontSize();
  wireLogin();
  wireTabs();
  wireMenus();
  let user = null;
  try {
    user = await Api.me();
  } catch {
    user = null;
  }
  if (user) enterApp(user);
  else showLogin();
}

boot();

// service worker (offline shell)
if ('serviceWorker' in navigator) {
  // Když novou verzi převezme nový service worker, jednou stránku obnovíme – ať se po
  // aktualizaci nemíchají staré a nové soubory (jinak by appka mohla zůstat „prázdná").
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  });
}
