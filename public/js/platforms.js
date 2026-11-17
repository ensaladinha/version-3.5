// "Escuchar completa": abre la canción en el servicio de streaming que la persona prefiera.
// Son enlaces de búsqueda directa: no usan ninguna API ni gastan cuota del servidor.
import { $, enc, esc, ico } from './util.js';
import { P, learn, save } from './state.js';
import { openDialog, closeDialog, focusDialog } from './dialog.js';

export const PLATFORMS = [
  { id: 'spotify', name: 'Spotify', url: q => 'https://open.spotify.com/search/' + enc(q) },
  { id: 'ytmusic', name: 'YouTube Music', url: q => 'https://music.youtube.com/search?q=' + enc(q) },
  { id: 'apple', name: 'Apple Music / iCloud', url: q => 'https://music.apple.com/search?term=' + enc(q) },
  { id: 'deezer', name: 'Deezer', url: q => 'https://www.deezer.com/search/' + enc(q) },
  { id: 'tidal', name: 'Tidal', url: q => 'https://tidal.com/search?q=' + enc(q) },
  { id: 'amazon', name: 'Amazon Music', url: q => 'https://music.amazon.com/search/' + enc(q) }
];
export const platformById = id => PLATFORMS.find(p => p.id === id);
export const songQuery = it => [it?.artist, it?.title].filter(Boolean).join(' ');
const go = (p, it) => { learn(it, 2); window.open(p.url(songQuery(it)), '_blank', 'noopener'); }; // una escucha completa es señal fuerte de interés

/** Botón de la tarjeta / del reproductor. Con app preferida abre directo; si no, muestra el selector. */
export function listenFull(it, { choose = false } = {}) {
  if (!it) return;
  const pref = platformById(P.musicApp);
  if (pref && !choose) return go(pref, it);
  chooser(it);
}

function chooser(it) {
  const m = $('#modal'), q = songQuery(it);
  m.innerHTML = `<div class="box fullbox" role="dialog" aria-modal="true" aria-labelledby="fl-t">
<h2 id="fl-t" tabindex="-1">Escuchar completa</h2>
<p class="m">${esc(q)}</p><p class="m">Elegí dónde abrirla. Te llevamos a la búsqueda de la canción en esa app.</p>
<ul class="plats">${PLATFORMS.map(p => `<li><a class="btn" data-pl="${p.id}" href="${esc(p.url(q))}" target="_blank" rel="noopener noreferrer">${esc(p.name)} ${ico.ext}<span class="sr">(se abre en otra pestaña)</span></a></li>`).join('')}</ul>
<label class="rem"><input type="checkbox" id="fl-rem" ${P.musicApp ? 'checked' : ''}> Recordar mi elección para abrirla en un solo toque</label>
<div class="foot"><button type="button" class="ghost" id="fl-x">Cerrar</button></div></div>`;
  const close = () => closeDialog();
  openDialog(close);
  m.querySelectorAll('[data-pl]').forEach(a => a.addEventListener('click', () => {
    learn(it, 2);
    if ($('#fl-rem').checked) { P.musicApp = a.dataset.pl; save(); } else if (P.musicApp) { P.musicApp = ''; save(); }
    setTimeout(close, 0); // el enlace se abre solo; después se cierra el diálogo
  }));
  $('#fl-x').onclick = close;
  focusDialog('#fl-t');
}
