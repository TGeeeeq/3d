// Hodiny: výkaz dobrovolnických hodin + odměny (body za odpracovaný čas).
'use strict';
import { Store } from './store.js';
import {
  $, $$, toast, openSheet, closeOverlay, escapeHtml, fmtDate, fmtHours, confirmSheet, emptyState, getUser,
} from './ui.js';

const POINTS_PER_HOUR = 10;
let activePanel = 'hours';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function openHoursForm() {
  const sheet = openSheet(`
    <h2>Zapsat hodiny</h2>
    <div class="field"><label>Datum</label><input id="h-date" type="date" value="${todayISO()}"></div>
    <div class="field-row">
      <div class="field"><label>Hodin</label><input id="h-hours" type="number" inputmode="decimal" min="0.5" step="0.5" value="2"></div>
    </div>
    <div class="field"><label>Činnost</label><input id="h-act" type="text" placeholder="např. kosení, výsadba, monitoring" maxlength="120"></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const hours = parseFloat(sheet.querySelector('#h-hours').value);
    const date = sheet.querySelector('#h-date').value || todayISO();
    const activity = sheet.querySelector('#h-act').value.trim();
    if (!hours || hours <= 0) {
      toast('Zadej počet hodin');
      return;
    }
    closeOverlay();
    try {
      await Store.add('time', { hours, date, activity });
      toast('Hodiny zapsány ✓');
    } catch {
      toast('Uložení selhalo', { error: true });
    }
  };
}

function openRewardForm() {
  const sheet = openSheet(`
    <h2>Nová odměna</h2>
    <div class="field"><label>Název odměny</label><input id="r-title" type="text" placeholder="např. Týmová večeře" maxlength="80"></div>
    <div class="field"><label>Cena v bodech</label><input id="r-cost" type="number" inputmode="numeric" min="0" step="10" value="100"></div>
    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Přidat</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);
  sheet.querySelector('[data-cancel]').onclick = closeOverlay;
  sheet.querySelector('[data-save]').onclick = async () => {
    const title = sheet.querySelector('#r-title').value.trim();
    const cost = parseInt(sheet.querySelector('#r-cost').value, 10) || 0;
    if (!title) {
      toast('Zadej název');
      return;
    }
    closeOverlay();
    try {
      await Store.add('rewards', { title, cost, claimedBy: null, claimedAt: null });
      toast('Odměna přidána ✓');
    } catch {
      toast('Uložení selhalo', { error: true });
    }
  };
}

function renderHours(items) {
  const me = getUser()?.name;
  const total = items.reduce((s, t) => s + (Number(t.hours) || 0), 0);
  const mine = items.filter((t) => t.author === me).reduce((s, t) => s + (Number(t.hours) || 0), 0);
  if ($('#h-total')) $('#h-total').textContent = fmtHours(total);
  if ($('#h-mine')) $('#h-mine').textContent = fmtHours(mine);
  if ($('#r-points')) $('#r-points').textContent = Math.round(total * POINTS_PER_HOUR);

  const list = $('#hours-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = emptyState('⏱️', 'Zatím žádné zapsané hodiny. Klepni na + a zapiš první.');
    return;
  }
  list.innerHTML = items
    .map(
      (t) => `
    <div class="card">
      <div class="row between">
        <h3>${escapeHtml(t.activity || 'Práce v terénu')}</h3>
        <span class="num leaf" style="font-size:18px;font-weight:800">${escapeHtml(fmtHours(t.hours))}</span>
      </div>
      <div class="meta">
        <span class="pill author">${escapeHtml(t.author || '?')}</span>
        <span>${escapeHtml(fmtDate(t.date || t.createdAt))}</span>
        <span class="spacer"></span>
        <button class="btn-ghost" data-del="${t.id}" type="button" style="min-height:32px;padding:0 12px">Smazat</button>
      </div>
    </div>`
    )
    .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tento záznam hodin?', { okText: 'Smazat', danger: true }))) return;
      try {
        await Store.remove('time', b.dataset.del);
        toast('Smazáno');
      } catch {
        toast('Smazání selhalo', { error: true });
      }
    };
  });
}

function renderRewards(items) {
  const list = $('#rewards-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = emptyState('🏅', 'Žádné odměny. Přidej cíl, na který tým společně „sbírá“ body.');
    return;
  }
  list.innerHTML = items
    .map((r) => {
      const claimed = !!r.claimedBy;
      return `
      <div class="card" style="${claimed ? 'opacity:.7' : ''}">
        <div class="row between">
          <h3>${escapeHtml(r.title)}</h3>
          <span class="pill cat">${escapeHtml(String(r.cost))} b</span>
        </div>
        <div class="meta">
          ${claimed
            ? `<span>✅ Získal(a): <b>${escapeHtml(r.claimedBy)}</b></span>`
            : `<button class="btn-soft" data-claim="${r.id}" type="button" style="min-height:36px;padding:0 14px">Označit jako získané</button>`}
          <span class="spacer"></span>
          <button class="btn-ghost" data-delr="${r.id}" type="button" style="min-height:32px;padding:0 12px">Smazat</button>
        </div>
      </div>`;
    })
    .join('');
  list.querySelectorAll('[data-claim]').forEach((b) => {
    b.onclick = async () => {
      try {
        await Store.update('rewards', b.dataset.claim, {
          claimedBy: getUser()?.name || '?',
          claimedAt: new Date().toISOString(),
        });
        toast('Odměna získána 🎉');
      } catch {
        toast('Uložení selhalo', { error: true });
      }
    };
  });
  list.querySelectorAll('[data-delr]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tuto odměnu?', { okText: 'Smazat', danger: true }))) return;
      try {
        await Store.remove('rewards', b.dataset.delr);
        toast('Smazáno');
      } catch {
        toast('Smazání selhalo', { error: true });
      }
    };
  });
}

function switchPanel(panel) {
  activePanel = panel;
  $('#panel-hours').hidden = panel !== 'hours';
  $('#panel-rewards').hidden = panel !== 'rewards';
  $('#fab-hours').hidden = panel !== 'hours';
  $('#fab-rewards').hidden = panel !== 'rewards';
  $$('#view-time .seg button').forEach((b) => b.classList.toggle('active', b.dataset.panel === panel));
}

export const TimeView = {
  collections: ['time', 'rewards'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Hodiny &amp; odměny</h2><div class="sub">Dobrovolnické hodiny týmu a body za práci</div></div></div>
      <div class="stat-grid">
        <div class="stat"><div class="num leaf" id="h-total">0 h</div><div class="lbl">Tým celkem</div></div>
        <div class="stat"><div class="num" id="h-mine">0 h</div><div class="lbl">Moje hodiny</div></div>
      </div>
      <div class="seg">
        <button data-panel="hours" class="active" type="button">⏱️ Hodiny</button>
        <button data-panel="rewards" type="button">🏅 Odměny</button>
      </div>
      <div id="panel-hours"><div id="hours-list"></div></div>
      <div id="panel-rewards" hidden>
        <div class="stat" style="margin-bottom:12px"><div class="num" id="r-points" style="color:var(--sun);text-shadow:0 1px 0 #c9a800">0</div><div class="lbl">Bodů týmu (10 b / hodina)</div></div>
        <div id="rewards-list"></div>
      </div>
      <button class="fab" id="fab-hours" type="button" aria-label="Zapsat hodiny">+</button>
      <button class="fab" id="fab-rewards" type="button" aria-label="Nová odměna" hidden>+</button>`;
    $$('#view-time .seg button').forEach((b) =>
      b.addEventListener('click', () => switchPanel(b.dataset.panel))
    );
    $('#fab-hours').addEventListener('click', openHoursForm);
    $('#fab-rewards').addEventListener('click', openRewardForm);
    Store.subscribe('time', renderHours);
    Store.subscribe('rewards', renderRewards);
    switchPanel('hours');
  },
};
