// Spravované lokality ČSOP Trosečníci (k.ú. Ostrov u Lanškrouna).
// Zdroj: studie Karla Málka „Realizace lokálního ÚSES" (trosecnici.vercel.app).
// Slouží jako číselník „výběr lokality" v mapě a katalog v záložce Lokality.
'use strict';

// Typy prvků ÚSES – pořadí určuje řazení v nabídce i v katalogu.
export const LOCALITY_TYPES = {
  zchu: { label: 'Zvláště chráněné území', icon: '🛡️' },
  biocentrum: { label: 'Biocentrum', icon: '🌳' },
  biokoridor: { label: 'Biokoridor', icon: '🔗' },
  vkp: { label: 'Významný krajinný prvek', icon: '⭐' },
};
export const TYPE_ORDER = ['zchu', 'biocentrum', 'biokoridor', 'vkp'];

export const LOCALITIES = [
  // ——— Zvláště chráněná území ———
  {
    id: 'u-kastanku', name: 'PR U Kaštánku', type: 'zchu', area: '23 ha',
    desc: 'Nejstarší a ochranářsky nejvýznamnější rezervace v katastru – vápnitá slatina pod Třebovskými stěnami s pcháčovými a ostřicovými loukami (vstavače, vachta trojlistá). ČSOP zde pečuje přes 30 let.',
  },
  {
    id: 'trebovske-steny', name: 'PR Třebovské stěny', type: 'zchu', area: '~50 ha',
    desc: 'Přírodně zachovalé květnaté bučiny a suťové lesy na kuestě; bezzásahové území, zároveň regionální biocentrum (RBC 356) na NRBK K 82.',
  },
  {
    id: 'pod-vodarnou', name: 'Pod vodárnou (navrhovaná PP)', type: 'zchu', area: '~8 ha',
    desc: 'Mokřadní mozaika olšin a slatinných luk při SZ okraji obce; největší populace bledule jarní v údolí. Podobná U Kaštánku, navržená na přírodní památku.',
  },

  // ——— Biocentra ———
  {
    id: 'hektarek', name: 'LBC Hektárek', type: 'biocentrum', area: '~8 ha',
    desc: 'Prameniště Ostrovského potoka na NRBK; revitalizovaný mokřad s tůněmi, cenné zoologicky (ptactvo, obojživelníci). Registrovaný VKP.',
  },
  {
    id: 'vresoviste', name: 'LBC Vřesoviště', type: 'biocentrum', area: '~4,5 ha',
    desc: 'Suchá stráň stepního charakteru s kyselým podložím na Hadím potoce; vzácné acidofilní druhy. Registrovaný VKP.',
  },
  {
    id: 'za-dvojkou', name: 'LBC Za dvojkou', type: 'biocentrum', area: '~2–4 ha',
    desc: 'Pastviny a listnaté porosty na strmém svahu, charakterem podobné Vřesovišti; na trase LBK Hadí potok.',
  },
  {
    id: 'paskundak', name: 'LBC Paskunďák', type: 'biocentrum', area: '',
    desc: 'Lesní a mokřadní biocentrum s rybníkem na Vraním potoce; nová hráz, biotop vodních organismů.',
  },
  {
    id: 'na-rozvodi', name: 'LBC Na rozvodí', type: 'biocentrum', area: '',
    desc: 'Lesní biocentrum (lesy zvláštního určení) v komplexu obecních lesů na NRBK; obnova po kůrovci, ponechávání doupných stromů.',
  },
  {
    id: 'za-rozvodim', name: 'LBC Za rozvodím', type: 'biocentrum', area: '',
    desc: 'Lesní biocentrum (LZU) v severní části lesa Na rozvodí, těsně před přechodem NRBK na sousední katastr Horní Dobrouč.',
  },
  {
    id: 'benduv-rybnik', name: 'LBC Bendův rybník', type: 'biocentrum', area: '',
    desc: 'Lesní a mokřadní biocentrum s obtokovým rybníkem na Vraním potoce; přirozená litorální zóna, bobři, obojživelníci.',
  },

  // ——— Biokoridory ———
  {
    id: 'nrbk-k82', name: 'NRBK K 82 (Na rozvodí)', type: 'biokoridor', area: '',
    desc: 'Nadregionální lesní biokoridor po hřebeni Třebovských stěn (evropské rozvodí Dunaj–Labe); zahrnuje vysázený ~1 km úsek mezi poli a lesy Na rozvodí.',
  },
  {
    id: 'vrani-potok', name: 'LBK Vraní potok', type: 'biokoridor', area: '',
    desc: 'Lokální lesoluční a mokřadní biokoridor nivou Vraního potoka od pramene po ústí; vysoká stabilita v lesních úsecích, bobří hráze, bledule.',
  },
  {
    id: 'hadi-potok', name: 'LBK Hadí potok', type: 'biokoridor', area: '',
    desc: 'Lokální lesoluční biokoridor nivou Hadího a Ostrovského potoka; místy blokovaný motokrosem, jinde ponechán přirozené sukcesi.',
  },
  {
    id: 'na-ranci', name: 'LBK Na ranči', type: 'biokoridor', area: '',
    desc: 'Krátký, ale strategický biokoridor propojující katastr na Rudoltice; revitalizovaný rybníček a mokřad (registrovaný VKP).',
  },
  {
    id: 'humperk', name: 'LBK Humperk', type: 'biokoridor', area: '',
    desc: 'Lesní pomocný biokoridor propojující biokoridory Hadího a Vraního potoka; součást obnovené Školní (poutní) cesty.',
  },
  {
    id: 'za-masopustem', name: 'LBK Za Masopustem', type: 'biokoridor', area: '',
    desc: 'Lesní pomocný biokoridor posilující NRBK; doprovodná zeleň a větrolam, malý Masopustův rybníček.',
  },
  {
    id: 'na-sahare', name: 'LBK Na Sahaře', type: 'biokoridor', area: '',
    desc: 'Lesní pomocný biokoridor rozdělující velký lán pole; posiluje NRBK, estetický prvek a budoucí větrolam.',
  },
  {
    id: 'rudolticka', name: 'LBK Rudoltička', type: 'biokoridor', area: '',
    desc: 'Plánovaný mokřadní biokoridor revitalizovaného Rudoltického potoka v jižním údolí – klíčový záměr ČSOP (potok s meandry).',
  },

  // ——— Registrované VKP ———
  {
    id: 'ostrovske-rybniky', name: 'VKP Ostrovské rybníky', type: 'vkp', area: '',
    desc: 'Středověké rybníky na Hadím/Ostrovském potoce (Přírodní park Lanškrounské rybníky); motýlí a vstavačové louky, zaplaveno bobry.',
  },
  {
    id: 'u-osady', name: 'VKP U osady', type: 'vkp', area: '',
    desc: 'Listnaté háje a křovinaté stráně ve východní části katastru; spolu s U dubu příčně propojuje hlavní biokoridory.',
  },
  {
    id: 'u-dabliku', name: 'VKP U ďáblíku', type: 'vkp', area: '',
    desc: 'Mokřadní a olšový biotop mezi lány polí v severní části katastru (čertkus, vachta).',
  },
  {
    id: 'na-planine', name: 'VKP Na planině', type: 'vkp', area: '',
    desc: 'Mokřad a březina v severní části katastru; část slatiny je v soukromém vlastnictví.',
  },
];

const BY_ID = new Map(LOCALITIES.map((l) => [l.id, l]));

export function localityById(id) {
  return id ? BY_ID.get(id) || null : null;
}
export function localityName(id) {
  return localityById(id)?.name || '';
}

// Seskupení lokalit podle typu v pevném pořadí TYPE_ORDER.
export function localitiesByType() {
  return TYPE_ORDER
    .map((type) => ({ type, meta: LOCALITY_TYPES[type], items: LOCALITIES.filter((l) => l.type === type) }))
    .filter((g) => g.items.length);
}

// <option> seznam pro <select> – data jsou důvěryhodné konstanty (bez escapování).
export function localityOptionsHtml(selected = '') {
  let html = `<option value=""${selected ? '' : ' selected'}>— bez lokality —</option>`;
  for (const g of localitiesByType()) {
    html += `<optgroup label="${g.meta.icon} ${g.meta.label}">`;
    html += g.items
      .map((l) => `<option value="${l.id}"${l.id === selected ? ' selected' : ''}>${l.name}</option>`)
      .join('');
    html += '</optgroup>';
  }
  return html;
}
