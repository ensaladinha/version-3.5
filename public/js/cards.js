// Tarjetas (HTML) y sus acciones: reproducir, favorito, "no me interesa", tráiler.
// Accesibilidad: cada tarjeta tiene UN enlace principal (el título) que se estira sobre toda la tarjeta con CSS;
// los botones secundarios quedan por encima. Así no hay controles anidados dentro de otros controles.
import { $, $$, api, config, enc, esc, fmtDate, ico, playBtn, safeUrl, toast } from './util.js';
import { ITEMS, P, label, learn, save, session } from './state.js';
import { listenFull } from './platforms.js';
import { closeDialog, focusDialog, openDialog } from './dialog.js';
import { why } from './recommender.js';
import { Q, cur, isPlaying, play, toggle } from './player.js';

export const CAT = { music: ['Música', ico.music], games: ['Juegos', ico.games], media: ['Series', ico.media] };
export const catOf = it => it.type === 'song' ? 'music' : (it.type === 'news' || it.type === 'game') ? 'games' : 'media';
const CTA = it => ({ song: 'Escuchar', news: 'Ver resumen', game: 'Ver ficha' })[it.type] || 'Ver tráiler';
const reg = it => (ITEMS.set(it.id, it), it);
export const img = u => u ? `<img loading="lazy" decoding="async" src="${esc(safeUrl(u))}" alt="" data-hide>` : ''; // si falla, un manejador global la quita
// Fecha legible (zona y formato de la persona) en vez de la ISO cruda; el servidor manda la fecha en publishedAt.
export const subOf = it => [it.subtitle, it.type === 'news' && it.publishedAt ? fmtDate(it.publishedAt) : ''].filter(Boolean).join(' · ');
const isExt = it => it.type === 'game' && safeUrl(it.sourceUrl) !== '#'; // las noticias abren primero el resumen (ver openNews)
// Si el destino es una página externa, el enlace principal es un <a href> de verdad (clic central, copiar dirección, arrastrar…);
// si abre el reproductor o un tráiler, sigue siendo un botón.
const mainLink = it => isExt(it)
  ? `<a class="cl" data-go="${esc(it.id)}" href="${esc(safeUrl(it.sourceUrl))}" target="_blank" rel="noopener noreferrer">${esc(it.title)}<span class="sr"> (se abre en otra pestaña)</span></a>`
  : `<button type="button" class="cl" data-go="${esc(it.id)}">${esc(it.title)}</button>`;
const cta = (it, text = CTA(it)) => `<span class="cta" aria-hidden="true" ${it.type === 'song' ? `data-cs="${esc(it.id)}" data-lb="${esc(text)}"` : ''}>${text} →</span>`;
// Solo se guardan los campos necesarios: el perfil viaja al servidor (límite 200 kB) y no debe crecer sin control.
const slim = ({ id, type, title, subtitle, image, tags, artist, previewUrl, trailerUrl, sourceUrl, publishedAt, popularity }) =>
  ({ id, type, title, subtitle, image, tags, artist, previewUrl, trailerUrl, sourceUrl, publishedAt, popularity });

// ---------- tarjeta de grilla ----------
export function card(item) {
  const it = reg(item), c = catOf(it), wy = why(it, P, label), fav = P.favorites.some(f => f.id === it.id), ext = safeUrl(it.sourceUrl);
  let a;
  if (it.type === 'song') a = `<button class="p" data-a="play" aria-label="Reproducir ${esc(it.title)}">${playBtn(isPlaying(it))}</button><button data-a="full" aria-label="Escuchar completa en otra app: ${esc(it.title)}" title="Escuchar la canción completa en Spotify, YouTube Music, Apple Music…"><span>Completa</span>${ico.ext}</button>`;
  else if (it.type === 'news') a = `<button class="p" data-a="news" aria-haspopup="dialog">Ver resumen</button>`;
  else if (it.type === 'game') a = `<button class="p" data-a="trailer">${ico.play}<span>Tráiler</span></button><a class="btn" data-a="click" href="${esc(ext)}" target="_blank" rel="noopener noreferrer">Steam ${ico.ext}<span class="sr">(se abre en otra pestaña)</span></a>`;
  else a = `<button class="p" data-a="trailer">${ico.play}<span>Ver tráiler</span></button>`;
  if (it.type !== 'news') a += `<button data-a="fav" aria-pressed="${fav}" aria-label="${fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" title="Favorito">${fav ? ico.heartOn : ico.heart}</button>`;
  a += `<button data-a="no" aria-label="No me interesa: ${esc(it.title)}" title="No me interesa">${ico.no}</button>`;
  return `<article class="card ${it.type} cat-${c}" data-id="${esc(it.id)}"><div class="im"><i class="ic">${CAT[c][1]}</i>${img(it.image)}</div>
<div class="b"><h3>${esc(it.title)}</h3><p>${esc(subOf(it))}</p>${wy ? `<small>${esc(wy)}</small>` : ''}<div class="act">${a}</div></div></article>`;
}
export const grid = l => l.length ? `<div class="grid">${l.map(card).join('')}</div>` : '<p class="m empty">Sin resultados.</p>';

// ---------- tarjetas de la portada ----------
export const heroCard = (it, sub) => (reg(it), `<article class="hc cat-${catOf(it)}"><span class="pill">${CAT[catOf(it)][0]}</span><i class="ic">${CAT[catOf(it)][1]}</i>
<h3>${mainLink(it)}</h3><p>${esc(sub ?? subOf(it))}</p>${cta(it, it.type === 'song' ? 'Escuchar ahora' : CTA(it))}</article>`);
export const isRecent = it => it.publishedAt && Date.now() - it.publishedAt < (it.type === 'song' ? 120 : 14) * 864e5;
export function newCard(it) {
  const c = catOf(it), rec = isRecent(it); reg(it);
  return `<article class="nc cat-${c}"><div class="th"><i class="ic">${CAT[c][1]}</i>${img(it.image)}<span class="pill">${CAT[c][0]}</span>${it.type === 'song' || rec ? `<span class="pill nw">${rec ? 'Nuevo' : 'Top'}</span>` : ''}</div>
<div class="tx"><h3>${mainLink(it)}</h3><p>${esc(subOf(it))}</p>${cta(it)}</div></article>`;
}
export function miniCard(it, discover) {
  reg(it);
  const w = why(it, P, label);
  const text = discover ? (w.startsWith('Parecido') ? w : w ? w.replace('Porque te gusta: ', 'Si te gusta ') + ', probá esto' : 'Nuevo para vos') : (w || 'Popular ahora');
  return `<article class="pc cat-${catOf(it)}"><div class="im"><i class="ic">${CAT[catOf(it)][1]}</i>${img(it.image)}</div>
<b class="why">${esc(text)}</b><h4>${mainLink(it)}</h4><button class="lk" data-no="${esc(it.id)}" aria-label="No me interesa: ${esc(it.title)}">No me interesa</button></article>`;
}
export const rankRows = l => l?.length
  ? `<ol class="tr">${l.slice(0, 5).map((it, i) => (reg(it), `<li class="cat-${catOf(it)}"><b aria-hidden="true">${i + 1}</b><div><strong>${mainLink(it)}</strong><small>${esc(subOf(it))}</small></div></li>`)).join('')}</ol>`
  : '<p class="m empty">No se pudo cargar. Probá de nuevo en unos minutos.</p>';

// ---------- acciones ----------
const ytLink = t => 'https://www.youtube.com/results?search_query=' + enc(t + ' tráiler');
export async function openTrailer(it) { // tráiler directo si hay clave de YouTube; si no, búsqueda
  if (it.trailerUrl) return void window.open(safeUrl(it.trailerUrl), '_blank', 'noopener');
  const w = window.open('', '_blank'); if (w) w.opener = null; // se abre dentro del clic para que el navegador no lo bloquee
  let url = ytLink(it.title);
  if (config.yt) { try { const { videoId } = await api('trailer?q=' + enc(it.title)); if (videoId) url = 'https://www.youtube.com/watch?v=' + videoId; } catch {} }
  w ? (w.location.href = url) : window.open(url, '_blank', 'noopener');
}
/** Ventana con el mini resumen de una novedad de videojuegos; "Ver más" lleva a la fuente original. */
export function openNews(it) {
  const m = $('#modal'), url = safeUrl(it.sourceUrl), when = it.publishedAt ? fmtDate(it.publishedAt) : '';
  learn(it, 1);
  m.innerHTML = `<div class="box newsbox" role="dialog" aria-modal="true" aria-labelledby="nw-t">
${it.image ? `<div class="nimg">${img(it.image)}</div>` : ''}
<h2 id="nw-t" tabindex="-1">${esc(it.title)}</h2>
<p class="m">${esc([it.subtitle, when].filter(Boolean).join(' · '))}</p>
<p class="nsum">${it.summary ? esc(it.summary) : 'Esta fuente no incluyó un resumen. Tocá «Ver más» para leer la noticia completa.'}</p>
<div class="foot"><button type="button" class="ghost" id="nw-x">Cerrar</button>${url !== '#' ? `<a class="btn pri" id="nw-more" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ver más ${ico.ext}<span class="sr">(se abre en otra pestaña)</span></a>` : ''}</div></div>`;
  openDialog(closeDialog);
  $('#nw-x').onclick = closeDialog;
  $('#nw-more')?.addEventListener('click', () => { learn(it, 1); setTimeout(closeDialog, 0); });
  focusDialog('#nw-t');
}
/** Acción principal de una tarjeta de la portada (el enlace del título). */
function primary(it) {
  if (!it) return;
  if (it.type === 'song') {
    if (cur()?.id === it.id) return toggle();
    const i = Q.chart.findIndex(s => s.id === it.id);
    Q.list = i >= 0 ? Q.chart : [it]; return play(i >= 0 ? i : 0);
  }
  if (it.type === 'news') return openNews(it);
  learn(it, 2);
  if (it.type === 'game') window.open(safeUrl(it.sourceUrl), '_blank', 'noopener'); else openTrailer(it);
}
function feedback(it) {
  const w = it.type === 'song' ? it.artist : why(it, P, label).replace(/^Porque te gusta: /, '');
  if (w) toast(`Anotado: vas a ver más de ${w}.`);
}
function hide(it, el) {
  P.blocked = [...P.blocked, it.id].slice(-500); learn(it, -4); el.remove();
  toast('Listo, vas a ver menos cosas como esta.', { label: 'Deshacer', run: () => {
    P.blocked = P.blocked.filter(id => id !== it.id); learn(it, 4); save();
    dispatchEvent(new Event('pulso:render'));
  } });
}
export function bindCards() {
  document.addEventListener('click', e => {
    const no = e.target.closest('[data-no]');
    if (no) return hide(ITEMS.get(no.dataset.no), no.closest('.pc'));
    const go = e.target.closest('[data-go]');
    if (go) { // un <a href> real se abre solo; acá solo se anota el interés
      const it = ITEMS.get(go.dataset.go);
      return go.tagName === 'A' ? learn(it, it?.type === 'news' ? 1 : 2) : primary(it);
    }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const el = b.closest('[data-id]'), it = ITEMS.get(el?.dataset.id), a = b.dataset.a; if (!it) return;
    if (a === 'click') learn(it, 1);
    else if (a === 'play') {
      if (cur()?.id === it.id) return toggle();
      const songs = $$('#view .card.song').filter(c => c.offsetParent).map(c => ITEMS.get(c.dataset.id));
      Q.list = songs; play(songs.indexOf(it));
    } else if (a === 'full') listenFull(it);
    else if (a === 'news') openNews(it);
    else if (a === 'fav') {
      if (!session.user) return toast('Creá una cuenta gratis para guardar tus favoritos.', { label: 'Crear cuenta', run: () => dispatchEvent(new Event('pulso:login')) });
      const i = P.favorites.findIndex(f => f.id === it.id), on = i < 0;
      if (on) { P.favorites.push(slim(it)); learn(it, 4); feedback(it); } else { P.favorites.splice(i, 1); learn(it, -4); }
      b.innerHTML = on ? ico.heartOn : ico.heart; b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? 'Quitar de favoritos' : 'Agregar a favoritos');
    } else if (a === 'no') hide(it, el);
    else if (a === 'trailer') { learn(it, 2); openTrailer(it); }
  });
}
