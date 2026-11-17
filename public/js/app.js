// Punto de entrada: sesión, router y eventos globales. La lógica vive en los otros módulos.
import { $, $$, ago, stale, toast } from './util.js';
import { P, save, session, setProfile } from './state.js';
import { showAuth } from './auth.js';
import { bindCards } from './cards.js';
import { V, skeleton, errorState } from './views.js';
import { setPlaying, stopAll } from './player.js';

const TITLES = { home: 'Inicio', music: 'Música', games: 'Videojuegos', media: 'Series y películas', profile: 'Mi perfil', search: 'Búsqueda' };
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } }; // un hash mal formado no debe romper la app

let token = 0; // cada navegación tiene el suyo: si llega una respuesta vieja, se descarta
export async function render() {
  stale.at = 0; // se vuelve a calcular con las respuestas de esta pantalla
  const mine = ++token, ctx = { alive: () => mine === token };
  const [sec, ...rest] = (location.hash.slice(2) || 'home').split('/');
  const name = V[sec] ? sec : 'home', view = $('#view');
  document.body.dataset.sec = name;
  document.title = `${TITLES[name]} · Pulso`;
  $$('#nav a').forEach(a => { const on = a.dataset.s === name; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  view.setAttribute('aria-busy', 'true'); view.innerHTML = skeleton(name);
  try { await V[name](safeDecode(rest.join('/')), ctx); }
  catch (e) { console.error(e); if (ctx.alive()) view.innerHTML = errorState(); }
  if (!ctx.alive()) return;
  view.setAttribute('aria-busy', 'false');
  setPlaying();
  // Datos guardados por el service worker (sin conexión): se dice de cuándo son, en vez de mostrarlos como si fueran de ahora.
  if (stale.at) view.insertAdjacentHTML('afterbegin', `<p class="notice" role="status">Sin conexión: estás viendo datos guardados ${ago(stale.at)}.</p>`);
}

const syncHeader = () => { $('#login').hidden = !!session.user; $('.pf').hidden = !session.user; };
const closeAuth = () => { $('#auth').hidden = true; $('#auth').innerHTML = ''; document.body.classList.remove('locked'); syncHeader(); render(); };
const askLogin = (mode = 'menu', opts = {}) => showAuth(enter, mode, { onCancel: closeAuth, ...opts });
async function enter(user, isNew, profile) {
  // Quien se registra conserva lo que ya eligió como invitado (gustos, favoritos): se guarda en su cuenta nueva.
  const guestData = isNew && (P.onboardingDone || Object.keys(P.tags).length) ? { ...P } : null;
  session.user = user; setProfile(guestData ?? profile ?? null); if (guestData) { P.rev = 0; save(); }
  // acceso y /auth/me ya traen el perfil; solo si falta se pide aparte
  if (!isNew && profile === undefined) try { const r = await fetch('/api/profile'); if (r.ok) setProfile((await r.json()).profile); } catch {}
  $('#auth').hidden = true; $('#auth').innerHTML = ''; document.body.classList.remove('locked'); syncHeader();
  if (location.hash !== '#/') location.hash = '#/'; else render();
}
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  stopAll(); session.user = null; setProfile(null); syncHeader();
  if (location.hash !== '#/') location.hash = '#/'; else render(); // se vuelve a la portada pública, no a un muro
}
// Entrada: sin cuenta se ve la portada pública igual; solo guardar favoritos o gustos pide cuenta.
async function boot() {
  const m = /^#\/reset\/([a-f0-9]{64})$/.exec(location.hash);
  if (m) { history.replaceState(null, '', location.pathname); return showAuth(enter, 'reset', { token: m[1], onCancel: closeAuth }); } // el token sale de la barra de direcciones enseguida
  try { const r = await fetch('/api/auth/me'); if (r.ok) { const d = await r.json(); return enter(d.user, false, d.profile); } } catch {}
  syncHeader(); render();
}

// ---------- eventos globales ----------
addEventListener('hashchange', render);
addEventListener('pulso:render', render);
addEventListener('pulso:logout', logout);
addEventListener('pulso:login', () => askLogin());
addEventListener('pulso:signed-out', () => { session.user = null; setProfile(null); syncHeader(); location.hash = '#/'; render(); }); // cuenta borrada o sesiones cerradas
addEventListener('pulso:conflict', () => { toast('Tu perfil se actualizó en otro dispositivo: cargamos la versión más nueva.'); render(); });
$('#login').onclick = () => askLogin();
addEventListener('offline', () => toast('Sin conexión: algunas cosas no van a cargar.'));
addEventListener('online', () => toast('Conexión recuperada.'));
document.addEventListener('click', e => { if (e.target.closest('[data-retry]')) { e.preventDefault(); render(); } });
// Imágenes que no cargan: se quitan y queda el ícono de fondo (no se puede usar onerror en línea por la CSP)
document.addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.hasAttribute('data-hide')) e.target.remove(); }, true);
// Tras navegar, el foco va al contenido (lectores de pantalla y teclado).
// Excepción: si la persona sigue escribiendo en el buscador (el cambio de hash lo provocó el propio buscador), el foco se queda ahí.
addEventListener('hashchange', () => { if (document.activeElement !== $('#gs')) $('#view').focus({ preventScroll: true }); });
// "Actualizado hace X" se refresca solo, con la hora real en que el servidor armó la portada
setInterval(() => { const u = $('#upd'); if (u) u.textContent = ago(+u.dataset.t); }, 30000);
bindCards();

let searchTimer;
const goSearch = () => { clearTimeout(searchTimer); const q = $('#gs').value.trim(); location.hash = q ? '#/search/' + encodeURIComponent(q) : '#/'; };
$('#gs').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(goSearch, 500); });
$('#gs').addEventListener('keydown', e => e.key === 'Enter' && goSearch());
boot();
if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
