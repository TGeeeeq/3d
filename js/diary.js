// Deník do terénu: napsat, nakreslit, nebo nahrát hlas. Text se průběžně sám zálohuje (koncept).
'use strict';
import { Store } from './store.js';
import { Api } from './api.js';
import {
  $, $$, toast, openSheet, closeOverlay, escapeHtml, authorChip, userColor, fmtDateTime, confirmSheet, emptyState, getUser,
} from './ui.js';
import { deleteButton, wireDeleteButtons } from './actions.js';

const DRAFT_KEY = 'ochr.diary.draft';
const FILTER_KEY = 'ochr.diary.filter';
let filterMine = false;
try {
  filterMine = localStorage.getItem(FILTER_KEY) === 'mine';
} catch {
  /* ignore */
}

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

// Fotku z mobilu zmenšíme na rozumný rozměr (max 1600 px, JPEG) – ať se nahraje
// spolehlivě i na slabém signálu a nepřekročí limit 12 MB v /api/media.
function downscaleImage(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load_failed'));
    };
    img.src = url;
  });
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
  let draft = '';
  try {
    draft = localStorage.getItem(DRAFT_KEY) || '';
  } catch {
    draft = '';
  }
  const sheet = openSheet(`
    <h2>Nový zápis do deníku</h2>
    <div class="field">
      <label>Text</label>
      <textarea id="d-text" rows="4" placeholder="Co se dnes v terénu dělo…">${escapeHtml(draft)}</textarea>
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
      <label>Fotka z terénu <span style="font-weight:500;color:var(--muted)">(nepovinné)</span></label>
      <div class="row" style="gap:8px">
        <button type="button" id="d-photo-cam" class="btn-soft" style="flex:1;min-height:44px">📷 Vyfotit</button>
        <button type="button" id="d-photo-pick" class="btn-soft" style="flex:1;min-height:44px">🖼️ Vybrat</button>
      </div>
      <input id="d-photo-cam-input" type="file" accept="image/*" capture="environment" hidden>
      <input id="d-photo-pick-input" type="file" accept="image/*" hidden>
      <div id="d-photo-wrap" hidden style="margin-top:8px;position:relative">
        <img id="d-photo-prev" class="media-img" alt="náhled fotky">
        <button type="button" id="d-photo-clear" class="btn-ghost" style="position:absolute;top:8px;right:8px;background:rgba(255,255,255,.92);min-height:34px;padding:0 12px">Odebrat</button>
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

  const textEl = sheet.querySelector('#d-text');
  textEl.addEventListener('input', () => {
    try {
      localStorage.setItem(DRAFT_KEY, textEl.value);
    } catch {
      /* ignore */
    }
  });

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

  let photoBlob = null;
  const photoWrap = sheet.querySelector('#d-photo-wrap');
  const photoPrev = sheet.querySelector('#d-photo-prev');
  const camInput = sheet.querySelector('#d-photo-cam-input');
  const pickInput = sheet.querySelector('#d-photo-pick-input');
  const onPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // umožní vybrat tutéž fotku znovu po odebrání
    if (!file) return;
    try {
      photoBlob = await downscaleImage(file);
      photoPrev.src = URL.createObjectURL(photoBlob);
      photoWrap.hidden = false;
    } catch {
      toast('Fotku se nepodařilo načíst', { error: true });
    }
  };
  camInput.addEventListener('change', onPhoto);
  pickInput.addEventListener('change', onPhoto);
  sheet.querySelector('#d-photo-cam').onclick = () => camInput.click();
  sheet.querySelector('#d-photo-pick').onclick = () => pickInput.click();
  sheet.querySelector('#d-photo-clear').onclick = () => {
    photoBlob = null;
    photoWrap.hidden = true;
    photoPrev.removeAttribute('src');
  };

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  sheet.querySelector('[data-cancel]').onclick = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    closeOverlay();
  };

  sheet.querySelector('[data-save]').onclick = async () => {
    const text = textEl.value.trim();
    if (!text && !pen.isDirty() && !audioBlob && !photoBlob) {
      toast('Zápis je prázdný');
      return;
    }
    const saveBtn = sheet.querySelector('[data-save]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukládám…';
    const entry = { text };
    try {
      // Média potřebují připojení – nahrajeme je teď, ať se neztratí kresba/hlas.
      if (pen.isDirty()) entry.drawingKey = await Api.uploadMedia(await pen.toBlob(), 'png');
      if (photoBlob) entry.photoKey = await Api.uploadMedia(photoBlob, 'jpg');
      if (audioBlob) entry.audioKey = await Api.uploadMedia(audioBlob, audioExt);
    } catch {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Uložit zápis';
      toast('Fotku/kresbu/hlas nelze nahrát bez připojení. Text můžeš uložit hned, médium přidej online.', { error: true, ms: 4500 });
      return;
    }
    await Store.add('diary', entry); // text se uloží i offline (fronta)
    clearDraft();
    closeOverlay();
    toast('Zápis uložen ✓');
  };
}

function setFilter(mine) {
  filterMine = mine;
  try {
    localStorage.setItem(FILTER_KEY, mine ? 'mine' : 'all');
  } catch {
    /* ignore */
  }
  $$('#view-diary .seg button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === mine));
  renderList(Store.get('diary'));
}

function renderList(items) {
  const list = $('#diary-list');
  if (!list) return;
  const me = getUser()?.name;
  const shown = filterMine ? items.filter((e) => e.author === me) : items;
  if (!shown.length) {
    list.innerHTML = emptyState('📓', 'Zatím prázdný deník. Klepni na + a přidej první zápis.');
    return;
  }
  list.innerHTML = shown
    .map((e) => {
      const img = e.drawingKey ? `<img class="media-img" loading="lazy" src="${Api.mediaUrl(e.drawingKey)}" alt="kresba">` : '';
      const photo = e.photoKey ? `<img class="media-img" loading="lazy" src="${Api.mediaUrl(e.photoKey)}" alt="fotka z terénu">` : '';
      const audio = e.audioKey ? `<audio class="media-audio" controls preload="none" src="${Api.mediaUrl(e.audioKey)}"></audio>` : '';
      return `
      <div class="card" style="border-left:4px solid ${userColor(e.author)}">
        <div class="meta" style="margin-top:0;margin-bottom:6px">
          ${authorChip(e.author)}
          <span>${escapeHtml(fmtDateTime(e.createdAt))}</span>
          ${e._pending ? '<span class="pend">⏳ ukládá se</span>' : ''}
        </div>
        ${e.text ? `<div class="body">${escapeHtml(e.text)}</div>` : ''}
        ${photo}${img}${audio}
        <div class="sheet-buttons" style="margin-top:10px">
          ${deleteButton(e, { mineCls: 'danger', style: '' })}
        </div>
      </div>`;
    })
    .join('');
  wireDeleteButtons(list, 'diary', (id) => shown.find((x) => x.id === id), (e) => e.text || 'zápis v deníku');
}

export const DiaryView = {
  collections: ['diary'],
  mount(viewEl) {
    viewEl.innerHTML = `
      <div class="view-head"><div><h2>Terénní deník</h2><div class="sub">Text, kresba i hlas – sdílené v týmu</div></div></div>
      <div class="seg">
        <button data-f="all" class="active" type="button">👥 Vše</button>
        <button data-f="mine" type="button">🙋 Moje</button>
      </div>
      <div id="diary-list"></div>
      <button class="fab" id="diary-add" type="button" aria-label="Nový zápis">+</button>`;
    $$('#view-diary .seg button').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.f === 'mine')));
    $$('#view-diary .seg button').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'mine') === filterMine));
    $('#diary-add').addEventListener('click', openEntryForm);
    Store.subscribe('diary', renderList);
  },
};
