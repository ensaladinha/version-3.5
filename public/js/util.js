// Utilidades de DOM, red e íconos compartidas por todos los módulos del navegador.
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const enc = encodeURIComponent;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = u => /^https?:\/\//.test(u || '') ? u : '#';
export const unique = list => [...new Map(list.map(i => [i.id, i])).values()];

// ---------- avisos (toast) con acción opcional, p. ej. "Deshacer" ----------
let toastTimer;
export function toast(message, action) {
  const t = $('#toast');
  t.textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action.label;
    b.onclick = () => { t.classList.remove('on'); action.run(); };
    t.append(' ', b);
  }
  t.classList.toggle('act', !!action);
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), action ? 6000 : 3000);
}

// ---------- red ----------
export class ApiError extends Error { constructor(status) { super('API ' + status); this.status = status; } }
export async function api(path) {
  const r = await fetch('/api/' + path, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new ApiError(r.status);
  const old = Number(r.headers.get('x-pulso-stale')); if (old) stale.at = Math.max(stale.at, old);
  return r.json();
}
export const config = { yt: false, ytMusic: false }; // yt: tráilers por YouTube · ytMusic: canción completa embebida (opt-in en el servidor)
fetch('/api/config').then(r => r.json()).then(c => { config.yt = !!c.yt; config.ytMusic = !!c.ytMusic; }).catch(() => {});

// ---------- datos viejos (sin conexión) y fechas legibles ----------
// El service worker responde con la última copia guardada y avisa con la cabecera x-pulso-stale (hora en que se guardó).
export const stale = { at: 0 };
const DT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }); // zona horaria y formato de la persona, no ISO en UTC
export const fmtDate = t => t ? DT.format(t) : '';
export const ago = t => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : `hace ${Math.floor(m / 1440)} d`; };

// ---------- íconos de línea (un solo juego, SVG) ----------
export const svg = (d, size = 18, fill = 'none') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const HEART = '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>';
export const ico = {
  play: svg('<path d="M7 4.5v15l12.5-7.5z"/>', 16, 'currentColor'),
  pause: svg('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', 16, 'currentColor'),
  heart: svg(HEART), heartOn: svg(HEART, 18, 'currentColor'),
  no: svg('<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>'),
  ext: svg('<path d="M7 17 17 7M8 7h9v9"/>', 14),
  music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', '1em'),
  games: svg('<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r=".6"/><circle cx="17.5" cy="13" r=".6"/>', '1em'),
  media: svg('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="m17 2-5 5-5-5"/>', '1em')
};
export const playBtn = on => on ? `${ico.pause}<span>Pausar</span>` : `${ico.play}<span>Escuchar</span>`;
