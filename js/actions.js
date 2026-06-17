// Sdílené akce: mazání s vlastnictvím (smazat smí jen autor; ostatní „navrhnou smazání").
'use strict';
import { Store } from './store.js';
import { confirmSheet, toast, getUser, escapeHtml } from './ui.js';

export function isMine(item) {
  return (item && item.author ? item.author : null) === (getUser()?.name || null);
}

// HTML tlačítka pro mazání – autor vidí „Smazat", ostatní „Navrhnout smazání".
export function deleteButton(item, { mineCls = 'btn-ghost', proposeCls = 'btn-soft', style = 'min-height:32px;padding:0 12px' } = {}) {
  const mine = isMine(item);
  return `<button class="${mine ? mineCls : proposeCls}" data-reqdel="${escapeHtml(item.id)}" type="button" style="${style}">${mine ? 'Smazat' : '🗑️ Navrhnout smazání'}</button>`;
}

// Zpracuje klik: autor maže rovnou (s potvrzením), ostatní pošlou návrh autorovi.
export async function requestDelete(collection, item, label = '') {
  if (isMine(item)) {
    if (!(await confirmSheet('Opravdu smazat?', { okText: 'Smazat', danger: true }))) return false;
    await Store.remove(collection, item.id);
    toast('Smazáno');
    return true;
  }
  await Store.add('notifications', {
    kind: 'delete_request',
    target: item.author || '?',
    collection,
    recordId: item.id,
    label: (label || '').slice(0, 140),
  });
  toast(`Návrh na smazání odeslán uživateli ${item.author || '?'} 📨`, { ms: 3200 });
  return false;
}

// Napojí všechna tlačítka [data-reqdel] v kontejneru na requestDelete.
// findItem(id) -> položka (kvůli zjištění autora a labelu).
export function wireDeleteButtons(root, collection, findItem, labelOf = () => '') {
  root.querySelectorAll('[data-reqdel]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const item = findItem(b.dataset.reqdel);
      if (!item) return;
      await requestDelete(collection, item, labelOf(item));
    };
  });
}
