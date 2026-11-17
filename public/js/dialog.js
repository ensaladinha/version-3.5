// Diálogo modal accesible: foco atrapado dentro, Escape para cerrar y el foco vuelve a donde estaba.
import { $, $$ } from './util.js';
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])';
let opener = null, onClose = null;

export function openDialog(onCloseFn) {
  const m = $('#modal');
  opener = document.activeElement; onClose = onCloseFn; m.hidden = false;
  document.body.classList.add('modal-open');
  $('#view').inert = true; $('header').inert = true; $('#dock').inert = true; // lo de atrás no recibe foco ni lectores de pantalla
}
export function closeDialog() {
  const m = $('#modal'); m.hidden = true; m.innerHTML = '';
  document.body.classList.remove('modal-open');
  $('#view').inert = false; $('header').inert = false; $('#dock').inert = false;
  const back = opener; opener = null; onClose = null;
  if (back?.isConnected) back.focus(); else $('#view').focus();
}
/** Llevar el foco al primer control del diálogo (se llama después de cada redibujado). */
export function focusDialog(preferred) {
  const m = $('#modal'); (preferred && m.querySelector(preferred) || m.querySelector('h2') || m).focus?.();
}
document.addEventListener('keydown', e => {
  const m = $('#modal'); if (m.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
  if (e.key !== 'Tab') return;
  const f = $$('#modal ' + FOCUSABLE.replaceAll(',', ', #modal ')).filter(x => x.offsetParent || x === document.activeElement);
  if (!f.length) return;
  const first = f[0], last = f.at(-1);
  if (e.shiftKey && (document.activeElement === first || !m.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
