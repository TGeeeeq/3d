// Rozpoznání druhu z fotky (Pl@ntNet) + sdílené UI. Používá deník i mapa.
'use strict';
import { Api } from './api.js';
import { openSheet, closeOverlay, escapeHtml, toast } from './ui.js';
import { assessSpecies, statusLabel, pladiasUrl } from './cz-species-status.js';

// Fotku z mobilu zmenšíme (max 1600 px, JPEG) – spolehlivý upload i na slabém signálu.
// Jediná kopie pro deník, mapu i určování druhu.
export function downscaleImage(file, maxDim = 1600, quality = 0.85) {
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

// Určování vyžaduje síť – Pl@ntNet nelze volat offline.
export const canIdentify = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const BADGE_STYLE = {
  protected: 'background:#ffebee;color:#c62828',
  redlist: 'background:#fff3e0;color:#e65100',
  invasive: 'background:#fff8e1;color:#f9a825',
  expansive: 'background:#efebe9;color:#6d4c41',
  unknown: 'background:#eceff1;color:#546e7a',
};
const badgeStyle = (kind) => BADGE_STYLE[kind] || BADGE_STYLE.unknown;

function badgeHtml(cz) {
  const l = statusLabel(cz);
  return `<span class="pill" style="${badgeStyle(l.kind)}">${l.icon} ${escapeHtml(l.text)}</span>`;
}

// Štítek určeného druhu pro výpisy (deník, náhled bodu). species = uložený objekt.
export function speciesChipHtml(species) {
  if (!species || !species.scientificName) return '';
  const name = species.commonName || species.scientificName;
  const pct = species.score ? ` · ${Math.round(species.score * 100)} %` : '';
  const url = (species.cz && species.cz.pladiasUrl) || pladiasUrl(species.scientificName);
  return `
    <div class="species-chip" style="margin:6px 0;padding:8px;border-radius:10px;background:var(--card,#f6f7f5)">
      <div><span class="pill cat">🌿 ${escapeHtml(name)}${pct}</span>
        <span style="font-style:italic;color:var(--muted)"> ${escapeHtml(species.scientificName)}</span></div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${badgeHtml(species.cz)}
        <a class="pill cat" href="${escapeHtml(url)}" target="_blank" rel="noopener">Pladias →</a>
      </div>
    </div>`;
}

// Pošle fotku k určení a nechá uživatele vybrat druh. Vrací Promise<species|null>.
// species = { scientificName, commonName, score, source, gbifId, cz:{...,pladiasUrl}, candidates }
export async function pickSpecies(blob) {
  openSheet(`<h2>🌿 Určuji druh…</h2>
    <p class="login-foot" style="text-align:left">Posílám fotku do Pl@ntNet…</p>`);
  let data;
  try {
    data = await Api.identifyPlant(blob);
  } catch (e) {
    closeOverlay();
    if (e.status === 503) toast('Určování druhů zatím není zapnuté', { error: true });
    else if (e.status === 429) toast('Denní limit určování je vyčerpán, zkus to zítra', { error: true, ms: 4000 });
    else toast('Rozpoznání se nezdařilo (potřebuje připojení)', { error: true });
    return null;
  }
  closeOverlay();

  const results = (data && data.results) || [];
  if (!results.length) {
    toast('Žádný druh se nepodařilo rozpoznat – zkus ostřejší fotku květu/listu', { ms: 4000 });
    return null;
  }

  return new Promise((resolve) => {
    const rows = results
      .map((r, i) => {
        const l = statusLabel(assessSpecies(r.scientificName));
        return `
        <button type="button" class="menu-item" data-pick="${i}" style="text-align:left;width:100%;display:block">
          <b>${escapeHtml(r.commonName || r.scientificName)}</b>
          <span class="pill cat" style="float:right">${Math.round(r.score * 100)} %</span><br>
          <span style="font-style:italic;color:var(--muted)">${escapeHtml(r.scientificName)}</span><br>
          <span class="pill" style="${badgeStyle(l.kind)};margin-top:4px;display:inline-block">${l.icon} ${escapeHtml(l.text)}</span>
        </button>`;
      })
      .join('');
    const sheet = openSheet(
      `<h2>🌿 Návrhy druhů</h2>
       <p class="login-foot" style="text-align:left;margin-top:0">Klepni na druh, který odpovídá. Powered by Pl@ntNet.</p>
       ${rows}
       <div class="sheet-buttons"><button class="secondary" data-cancel type="button">Žádný nesedí</button></div>`,
      () => resolve(null) // zavření přes pozadí / „Žádný nesedí" = nic nevybráno
    );
    sheet.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => {
        const r = results[+b.dataset.pick];
        const cz = assessSpecies(r.scientificName);
        const species = {
          scientificName: r.scientificName,
          commonName: r.commonName || '',
          score: r.score,
          source: 'plantnet',
          gbifId: r.gbifId ?? null,
          cz: { ...(cz || {}), pladiasUrl: pladiasUrl(r.scientificName) },
          candidates: results.map((x) => ({ scientificName: x.scientificName, commonName: x.commonName, score: x.score })),
        };
        resolve(species);
        closeOverlay();
      };
    });
    sheet.querySelector('[data-cancel]').onclick = () => closeOverlay();
  });
}
