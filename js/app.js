// Orchestrátor terénní aplikace ČSOP Trosečníci.
'use strict';
import { Api } from './api.js';
import { Store, setLiveCollections, startSync, stopSync } from './store.js';
import { $, $$, toast, openOverlay, closeOverlay, setUser } from './ui.js';
import { MapView } from './map.js';
import { TrackView } from './track.js';
import { DiaryView } from './diary.js';
import { TimeView } from './time.js';
import { FinanceView } from './finance.js';
import { LocalitiesView } from './localities.js';

const VIEWS = {
  map: MapView,
  track: TrackView,
  diary: DiaryView,
  time: TimeView,
  finance: FinanceView,
  localities: LocalitiesView,
};

let currentTab = null;

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
  setLiveCollections(view.collections || []);
  view.onShow?.();
  try {
    localStorage.setItem('ochr.tab', tab);
  } catch {
    /* ignore */
  }
}

function enterApp(user) {
  setUser(user);
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  $('#user-name').textContent = user.name;
  startSync(20000);
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const name = $('#login-name').value.trim();
    const code = $('#login-code').value;
    const btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Přihlašuji…';
    try {
      const user = await Api.login(code, name);
      try {
        localStorage.setItem('ochr.name', name);
      } catch {
        /* ignore */
      }
      enterApp(user);
    } catch (err) {
      errEl.textContent =
        err.message === 'bad_code' ? 'Neplatný přístupový kód.' : 'Přihlášení se nezdařilo. Zkus to znovu.';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Vstoupit';
    }
  });
  // předvyplnit jméno z minula
  try {
    const saved = localStorage.getItem('ochr.name');
    if (saved) $('#login-name').value = saved;
  } catch {
    /* ignore */
  }
}

function wireTabs() {
  document.querySelectorAll('#tabbar .tab').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab))
  );
}

function wireMenus() {
  $('#user-chip').addEventListener('click', () => openOverlay($('#app-menu')));
  $('#btn-app-menu-close').addEventListener('click', closeOverlay);
  $('#btn-localities').addEventListener('click', () => {
    closeOverlay();
    showTab('localities');
  });
  $('#btn-refresh-all').addEventListener('click', async () => {
    closeOverlay();
    toast('Načítám data…');
    await Promise.all(
      ['notes', 'tracks', 'diary', 'time', 'finance', 'rewards', 'localities'].map((c) =>
        Store.refresh(c).catch(() => {})
      )
    );
    toast('Hotovo ✓');
  });
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
