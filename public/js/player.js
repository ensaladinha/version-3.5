// Reproductor persistente: YouTube (si hay clave en el servidor) o preview de 30 s de iTunes como respaldo.
import { $, $$, api, config, enc, ico, playBtn, toast } from './util.js';
import { ITEMS, learn } from './state.js';
import { listenFull } from './platforms.js';

export const Q = { list: [], i: -1, chart: [] }; // cola de reproducción y ranking de la portada
const aud = $('#aud');
let yt, ytReady, mode = '', playing = false, noted = false;
export const cur = () => Q.list[Q.i];
export const isPlaying = it => playing && cur()?.id === it.id;
export const isActive = () => playing;

function ensureYT() {
  return ytReady ??= new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = () => {
      yt = new YT.Player('yt-player', { width: 220, height: 220, host: 'https://www.youtube-nocookie.com', playerVars: { playsinline: 1 }, events: {
        onReady: res,
        onStateChange: e => {
          if (e.data === 0) { setPlaying(false); learn(cur(), 2); next(true); }
          else if (e.data === 1) setPlaying(true);
          else if (e.data === 2) setPlaying(false);
        },
        onError: () => fallback(cur())
      } });
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => { ytReady = null; rej(new Error('yt')); };
    document.head.append(s);
  });
}
const showYT = v => { $('#ytbox').hidden = !v; };
const stopYT = () => { try { yt?.stopVideo(); } catch {} };

function fallback(t) {
  if (!t?.previewUrl) { showYT(false); return toast('No se pudo reproducir esta canción.'); }
  stopYT(); showYT(false); mode = 'aud'; aud.src = t.previewUrl;
  aud.play().catch(() => { setPlaying(false); toast('Tocá ▶ para reproducir.'); });
  if (!noted) { noted = true; toast('Suena la preview de 30 s de la canción.'); }
}

/** Reproduce la canción i de la cola. byUser=false: arrancó sola (la siguiente), no cuenta como interés. */
export async function play(i, byUser = true) {
  const t = Q.list[i]; if (!t) return;
  Q.i = i; if (byUser) learn(t, 1);
  mode = ''; setPlaying(false); stopYT(); aud.pause();
  $('#now').textContent = t.title; $('#art').textContent = t.artist || ''; setCover(t.image);
  updateMediaSession(t);
  if (!config.ytMusic) return fallback(t); // por defecto: preview directa de 30 s, dentro del clic (el navegador no la bloquea); la canción completa va por "Escuchar completa"
  showYT(true);
  if (matchMedia('(max-width: 600px)').matches) { $('#ytbox').classList.add('min'); $('#ytm').textContent = '+'; $('#ytm').setAttribute('aria-label', 'Agrandar video'); } // en celular arranca chico para no tapar el contenido
  try {
    await ensureYT();
    const { videoId } = await api(`music/resolve?title=${enc(t.title)}&artist=${enc(t.artist || '')}`);
    if (!videoId) throw new Error('sin video');
    mode = 'yt'; yt.loadVideoById(videoId);
  } catch { fallback(t); }
}
export function next(auto) {
  if (!auto) { const [pos, dur] = times(); if (pos < Math.min(10, (dur || 30) * 0.3)) learn(cur(), -1); } // saltarla enseguida resta
  if (Q.i + 1 < Q.list.length) play(Q.i + 1, false);
}
export function prev() { if (Q.i > 0) play(Q.i - 1); }
export function toggle() {
  if (mode === 'yt') yt.getPlayerState() === 1 ? yt.pauseVideo() : yt.playVideo();
  else if (mode === 'aud') aud.paused ? aud.play() : aud.pause();
  else if (!mode && Q.i < 0 && Q.list.length) play(0);
}
export function stopAll() { aud.pause(); stopYT(); Q.list = []; Q.i = -1; mode = ''; setPlaying(false); showYT(false); $('#now').textContent = 'Nada sonando'; $('#art').textContent = 'Tocá reproducir para escuchar'; setCover(''); }

/** Refresca todos los botones de reproducir según lo que suena. */
export function setPlaying(v = playing) {
  playing = v;
  $('#tog').innerHTML = v ? ico.pause : ico.play;
  $('#tog').setAttribute('aria-label', v ? 'Pausar' : 'Reproducir');
  for (const c of $$('#view .card.song')) { const b = c.querySelector('[data-a=play]'); if (b) b.innerHTML = playBtn(isPlaying(ITEMS.get(c.dataset.id) || {})); }
  for (const s of $$('[data-cs]')) s.textContent = (isPlaying({ id: s.dataset.cs }) ? 'Pausar' : s.dataset.lb) + ' →';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = v ? 'playing' : 'paused';
  v ? startTick() : (stopTick(), tick()); // el reloj de progreso corre solo mientras algo suena
}
function setCover(u) {
  const c = $('#cov'); c.hidden = !u; $('#cv').hidden = !!u;
  c.onerror = () => { c.hidden = true; $('#cv').hidden = false; };
  if (u) c.src = u;
}
// Teclas multimedia del teléfono / auriculares / pantalla de bloqueo
function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', artwork: t.image ? [{ src: t.image, sizes: '300x300' }] : [] });
  for (const [a, f] of [['play', toggle], ['pause', toggle], ['nexttrack', () => next(false)], ['previoustrack', prev]]) try { navigator.mediaSession.setActionHandler(a, f); } catch {}
}

const fmt = s => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const times = () => { try { return mode === 'yt' ? [yt.getCurrentTime(), yt.getDuration()] : mode === 'aud' ? [aud.currentTime, aud.duration] : [0, 0]; } catch { return [0, 0]; } };
const seekTo = f => { const [, d] = times(); if (!d) return; f = Math.min(1, Math.max(0, f)); mode === 'yt' ? yt.seekTo(f * d, true) : (aud.currentTime = f * d); setTimeout(tick, 50); };

// ---------- conexión con la página ----------
aud.onended = () => { setPlaying(false); learn(cur(), 2); next(true); };
aud.onplay = () => setPlaying(true);
aud.onpause = () => setPlaying(false);
aud.onerror = () => { if (mode === 'aud') { setPlaying(false); toast('No se pudo cargar el audio.'); } };

$('#tog').onclick = toggle; $('#next').onclick = () => next(false); $('#prev').onclick = prev;
$('#ytm').onclick = () => {
  const m = $('#ytbox').classList.toggle('min');
  $('#ytm').textContent = m ? '+' : '–'; $('#ytm').setAttribute('aria-label', m ? 'Agrandar video' : 'Minimizar video');
};
const pb = $('#pb');
pb.onclick = e => { const r = pb.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width); };
pb.onkeydown = e => { // el control de progreso también se maneja con el teclado
  const [c, d] = times(); if (!d) return;
  const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 15, PageDown: -15 }[e.key];
  if (step) { e.preventDefault(); seekTo((c + step) / d); }
  else if (e.key === 'Home') { e.preventDefault(); seekTo(0); }
  else if (e.key === 'End') { e.preventDefault(); seekTo(0.999); }
};
// Redibuja el progreso. Corre cada 500 ms SOLO mientras suena algo (en reposo no despierta la CPU del celular).
let timer = null;
function tick() {
  if (document.hidden) return; // pestaña en segundo plano: no hace falta redibujar el progreso
  const [c, d] = times(), pct = d ? Math.min(100, c / d * 100) : 0;
  $('#tc').textContent = fmt(c); $('#td').textContent = fmt(d); $('#pbf').style.width = pct + '%';
  pb.setAttribute('aria-valuenow', Math.round(pct)); pb.setAttribute('aria-valuetext', `${fmt(c)} de ${fmt(d)}`);
}
const startTick = () => { timer ??= setInterval(tick, 500); };
const stopTick = () => { clearInterval(timer); timer = null; };
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
$('#full').onclick = () => listenFull(cur()); // "Escuchar completa" de la canción que está sonando
