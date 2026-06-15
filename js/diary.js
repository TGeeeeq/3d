// Deník do terénu: napsat, nakreslit, nebo nahrát hlasovou poznámku.
'use strict';
import { Store } from './store.js';
import { Api } from './api.js';
import {
  $, toast, openSheet, closeOverlay, escapeHtml, fmtDateTime, confirmSheet, emptyState,
} from './ui.js';

// vybere podporovaný audio formát pro MediaRecorder
function pickAudio() {
  const opts = [
    ['audio/webm', 'webm'],
    ['audio/mp4', 'm4a'],
    ['audio/ogg', 'ogg'],
  ];
  for (const [mime, ext] of opts) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'webm' };
}

function setupCanvas(canvas) {
  canvas.width = 1000;
  canvas.height = 680;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1e3a2f';
  let drawing = false;
  let dirty = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: ((t.clientX - r.left) / r.width) * canvas.width, y: ((t.clientY - r.top) / r.height) * canvas.height };
  };
  const start = (e) => {
    e.preventDefault();
    drawing = true;
    dirty = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => {
    drawing = false;
  };
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);
  return {
    ctx,
    isDirty: () => dirty,
    setColor: (c) => (ctx.strokeStyle = c),
    clear: () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      dirty = false;
    },
    toBlob: () => new Promise((res) => canvas.toBlob(res, 'image/png', 0.92)),
  };
}

function openEntryForm() {
  const sheet = openSheet(`
    <h2>Nový zápis do deníku</h2>
    <div class="field">
      <label>Text</label>
      <textarea id="d-text" rows="4" placeholder="Co se dnes v terénu dělo…"></textarea>
    </div>

    <div class="field">
      <label>Kresba <span style="font-weight:500;color:var(--muted)">(nepovinné)</span></label>
      <div class="draw-wrap"><canvas id="d-canvas"></canvas></div>
      <div class="draw-tools">
        <button type="button" class="color-swatch selected" data-color="#1e3a2f" style="width:34px;height:34px;background:#1e3a2f"></button>
        <button type="button" class="color-swatch" data-color="#e53935" style="width:34px;height:34px;background:#e53935"></button>
        <button type="button" class="color-swatch" data-color="#1e88e5" style="width:34px;height:34px;background:#1e88e5"></button>
        <button type="button" class="color-swatch" data-color="#43a047" style="width:34px;height:34px;background:#43a047"></button>
        <span class="spacer"></span>
        <button type="button" class="btn-ghost" id="d-clear" style="min-height:34px;padding:0 12px">Vymazat</button>
      </div>
    </div>

    <div class="field">
      <label>Hlasová poznámka <span style="font-weight:500;color:var(--muted)">(nepovinné)</span></label>
      <div class="row" style="gap:8px">
        <button type="button" id="d-rec" class="btn-soft" style="flex:1;min-height:44px">🎙️ Nahrát</button>
        <span id="d-rec-time" style="font-weight:700;color:var(--danger)"></span>
      </div>
      <audio id="d-audio-prev" class="media-audio" controls hidden></audio>
    </div>

    <div class="sheet-buttons">
      <button class="primary" data-save type="button">Uložit zápis</button>
      <button class="secondary" data-cancel type="button">Zrušit</button>
    </div>`);

  const canvas = sheet.querySelector('#d-canvas');
  const pen = setupCanvas(canvas);
  sheet.querySelectorAll('.color-swatch').forEach((b) => {
    b.addEventListener('click', () => {
      sheet.querySelectorAll('.color-swatch').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      pen.setColor(b.dataset.color);
    });
  });
  sheet.querySelector('#d-clear').onclick = () => pen.clear();

  // --- hlas ---
  let mediaRecorder = null;
  let chunks = [];
  let audioBlob = null;
  let audioExt = 'webm';
  let recTimer = null;
  let recStart = 0;
  const recBtn = sheet.querySelector('#d-rec');
  const recTime = sheet.querySelector('#d-rec-time');
  const prev = sheet.querySelector('#d-audio-prev');

  recBtn.onclick = async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mime, ext } = pickAudio();
      audioExt = ext;
      mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        audioBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        prev.src = URL.createObjectURL(audioBlob);
        prev.hidden = false;
        recBtn.innerHTML = '🎙️ Nahrát znovu';
        recBtn.classList.remove('btn-danger');
        recBtn.classList.add('btn-soft');
        clearInterval(recTimer);
        recTime.textContent = '';
      };
      mediaRecorder.start();
      recStart = Date.now();
      recBtn.innerHTML = '<span class="rec-dot"></span> Zastavit';
      recBtn.classList.add('btn-danger');
      recBtn.classList.remove('btn-soft');
      recTimer = setInterval(() => {
        recTime.textContent = Math.round((Date.now() - recStart) / 1000) + ' s';
      }, 250);
    } catch {
      toast('Nepodařilo se zapnout mikrofon – zkontroluj povolení', { error: true });
    }
  };

  sheet.querySelector('[data-cancel]').onclick = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    closeOverlay();
  };

  sheet.querySelector('[data-save]').onclick = async () => {
    const text = sheet.querySelector('#d-text').value.trim();
    if (!text && !pen.isDirty() && !audioBlob) {
      toast('Zápis je prázdný');
      return;
    }
    const saveBtn = sheet.querySelector('[data-save]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukládám…';
    try {
      const entry = { text };
      if (pen.isDirty()) {
        const png = await pen.toBlob();
        entry.drawingKey = await Api.uploadMedia(png, 'png');
      }
      if (audioBlob) {
        entry.audioKey = await Api.uploadMedia(audioBlob, audioExt);
      }
      await Store.add('diary', entry);
      closeOverlay();
      toast('Zápis uložen ✓');
    } catch {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Uložit zápis';
      toast('Uložení selhalo – zkontroluj připojení', { error: true });
    }
  };
}

function renderList(items) {
  const list = $('#diary-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = emptyState('📓', 'Zatím prázdný deník. Klepni na + a přidej první zápis.');
    return;
  }
  list.innerHTML = items
    .map((e) => {
      const img = e.drawingKey
        ? `<img class="media-img" loading="lazy" src="${Api.mediaUrl(e.drawingKey)}" alt="kresba">`
        : '';
      const audio = e.audioKey
        ? `<audio class="media-audio" controls preload="none" src="${Api.mediaUrl(e.audioKey)}"></audio>`
        : '';
      return `
      <div class="card">
        <div class="meta" style="margin-top:0;margin-bottom:6px">
          <span class="pill author">${escapeHtml(e.author || '?')}</span>
          <span>${escapeHtml(fmtDateTime(e.createdAt))}</span>
        </div>
        ${e.text ? `<div class="body">${escapeHtml(e.text)}</div>` : ''}
        ${img}${audio}
        <div class="sheet-buttons" style="margin-top:10px">
          <button class="danger" data-del="${e.id}" type="button">Smazat</button>
        </div>
      </div>`;
    })
    .join('');
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmSheet('Smazat tento zápis?', { okText: 'Smazat', danger: true }))) return;
      try {
        await Store.remove('diary', b.dataset.del);
        toast('Smazáno');
      } catch {
        toast('Smazání selhalo', { error: true });
      }
    };
  });
}

export const DiaryView = {
  collections: ['diary'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Terénní deník</h2><div class="sub">Text, kresba i hlas – sdílené v týmu</div></div></div>
      <div id="diary-list"></div>
      <button class="fab" id="diary-add" type="button" aria-label="Nový zápis">+</button>`;
    $('#diary-add').addEventListener('click', openEntryForm);
    Store.subscribe('diary', renderList);
  },
};
