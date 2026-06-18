// Ochranářský status druhů – orientační číselník pro terén (funguje offline).
//
// Zdroje:
//  - zvláštní ochrana (legal: KO/SO/O) = příloha II vyhlášky č. 395/1992 Sb.
//    (kriticky / silně / ohrožený), kategorie ověřeny dle botany.cz.
//  - invazní = běžně uváděné nepůvodní invazní druhy ČR.
//  - expanzivní = domácí expanzivní druhy, typický cíl sečení/managementu na lokalitách.
//
// POZOR: jde o ORIENTAČNÍ VÝBĚR, ne úplný seznam (příloha II má 532 druhů rostlin).
// Právně závazné je vždy znění vyhlášky a posouzení konkrétní lokality. Pokud druh
// v číselníku není, aplikace ukáže „status neznámý – ověř v Pladias".
// Revize seznamu: 2026-06.
'use strict';

// Klíč = vědecké jméno (rod + druh) malými písmeny, bez autora.
// Hodnota: { legal?: 'KO'|'SO'|'O', redList?: string, invasive?: true, expansive?: true }
const STATUS = {
  // — zvláště chráněné: kriticky ohrožené (§1) —
  'pulsatilla patens': { legal: 'KO' },
  'pulsatilla vernalis': { legal: 'KO' },
  'drosera anglica': { legal: 'KO' },
  'drosera intermedia': { legal: 'KO' },
  'dactylorhiza maculata': { legal: 'KO' },
  'dactylorhiza traunsteineri': { legal: 'KO' },
  'leucojum aestivum': { legal: 'KO' },
  'gentiana verna': { legal: 'KO' },
  'pedicularis exaltata': { legal: 'KO' },
  'epipactis leptochila': { legal: 'KO' },
  'gladiolus palustris': { legal: 'KO' },

  // — zvláště chráněné: silně ohrožené (§2) —
  'pulsatilla grandis': { legal: 'SO' },
  'pulsatilla pratensis': { legal: 'SO' },
  'drosera rotundifolia': { legal: 'SO' },
  'dactylorhiza incarnata': { legal: 'SO' },
  'dactylorhiza sambucina': { legal: 'SO' },
  'lilium bulbiferum': { legal: 'SO' },
  'pinguicula vulgaris': { legal: 'SO' },
  'gentiana pneumonanthe': { legal: 'SO' },
  'gentiana pannonica': { legal: 'SO' },
  'gladiolus imbricatus': { legal: 'SO' },
  'iris sibirica': { legal: 'SO' },

  // — zvláště chráněné: ohrožené (§3) —
  'dactylorhiza majalis': { legal: 'O' },
  'menyanthes trifoliata': { legal: 'O' },
  'trollius altissimus': { legal: 'O' },
  'parnassia palustris': { legal: 'O' },
  'platanthera bifolia': { legal: 'O' },
  'platanthera chlorantha': { legal: 'O' },
  'arnica montana': { legal: 'O' },
  'lilium martagon': { legal: 'O' },
  'gentiana asclepiadea': { legal: 'O' },
  'gentiana cruciata': { legal: 'O' },
  'leucojum vernum': { legal: 'O' },
  'galanthus nivalis': { legal: 'O' },

  // — invazní nepůvodní druhy —
  'heracleum mantegazzianum': { invasive: true },
  'reynoutria japonica': { invasive: true },
  'reynoutria sachalinensis': { invasive: true },
  'reynoutria bohemica': { invasive: true },
  'impatiens glandulifera': { invasive: true },
  'impatiens parviflora': { invasive: true },
  'solidago canadensis': { invasive: true },
  'solidago gigantea': { invasive: true },
  'lupinus polyphyllus': { invasive: true },
  'robinia pseudoacacia': { invasive: true },
  'echinocystis lobata': { invasive: true },
  'helianthus tuberosus': { invasive: true },
  'telekia speciosa': { invasive: true },
  'rudbeckia laciniata': { invasive: true },
  'symphyotrichum novi-belgii': { invasive: true },
  'acer negundo': { invasive: true },

  // — domácí expanzivní druhy (cíl sečení/managementu) —
  'cirsium arvense': { expansive: true },
  'cirsium oleraceum': { expansive: true },
  'rumex obtusifolius': { expansive: true },
  'rumex crispus': { expansive: true },
  'urtica dioica': { expansive: true },
  'calamagrostis epigejos': { expansive: true },
  'phragmites australis': { expansive: true },
  'symphytum officinale': { expansive: true },
};

// Synonyma → kanonický klíč (Pl@ntNet/POWO jméno se může lišit od jména ve vyhlášce/Pladias).
const ALIASES = {
  'fallopia japonica': 'reynoutria japonica',
  'fallopia sachalinensis': 'reynoutria sachalinensis',
  'reynoutria ×bohemica': 'reynoutria bohemica',
  'aster novi-belgii': 'symphyotrichum novi-belgii',
  'pulsatilla pratensis subsp. bohemica': 'pulsatilla pratensis',
};

const LEGAL_NAMES = { KO: 'kriticky ohrožený', SO: 'silně ohrožený', O: 'ohrožený' };

// Normalizace na „rod druh" malými písmeny (zahodí autora, varietu, poddruh navíc).
function normalize(name) {
  const parts = String(name || '')
    .toLowerCase()
    .replace(/[×]/g, '×')
    .trim()
    .split(/\s+/);
  return parts.slice(0, 2).join(' ');
}

// Vrátí status druhu, nebo null když není v číselníku (= neznámý, ověřit v Pladias).
export function assessSpecies(scientificName) {
  const key = normalize(scientificName);
  const canon = ALIASES[key] || key;
  const s = STATUS[canon];
  return s ? { ...s } : null;
}

// Odkaz na oficiální kartu druhu v Pladias (autoritativní DB české flóry).
export function pladiasUrl(scientificName) {
  const name = String(scientificName || '').trim();
  return `https://pladias.cz/taxon/overview/${encodeURIComponent(name)}`;
}

// Štítek pro UI – vždy vrátí popis (i pro neznámý druh). kind řídí barvu.
export function statusLabel(cz) {
  if (cz && cz.legal) {
    return { kind: 'protected', icon: '🛡️', text: `Zvláště chráněný – ${LEGAL_NAMES[cz.legal] || cz.legal} (vyhl. 395/1992 Sb.)` };
  }
  if (cz && cz.invasive) {
    return { kind: 'invasive', icon: '⚠️', text: 'Invazní nepůvodní druh' };
  }
  if (cz && cz.expansive) {
    return { kind: 'expansive', icon: '🌾', text: 'Expanzivní – cíl sečení' };
  }
  if (cz && cz.redList) {
    return { kind: 'redlist', icon: '🟥', text: `Červený seznam: ${cz.redList}` };
  }
  return { kind: 'unknown', icon: '❔', text: 'Status neznámý – ověř v Pladias' };
}
