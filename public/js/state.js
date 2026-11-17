// Estado del usuario: perfil de gustos (vive en la cuenta, en el servidor) y cómo aprende de cada interacción.
import { decay, weight } from './recommender.js';
import { normName, tagLabel } from './shared.js';

export const session = { user: null };
export const ITEMS = new Map(); // id -> ítem mostrado (para resolver los clics de las tarjetas)
const fresh = () => ({ version: 1, onboardingDone: false, region: 'AR', tags: {}, bands: [], games: [], musicApp: '', adult: false, favorites: [], blocked: [] });
const arr = v => Array.isArray(v) ? v : [];
const clean = p => {
  const o = p && typeof p === 'object' ? p : {};
  return { ...fresh(), ...o, rev: Number(o.rev) || 0, tags: o.tags && typeof o.tags === 'object' && !Array.isArray(o.tags) ? o.tags : {},
    bands: arr(o.bands).filter(b => typeof b === 'string'), games: arr(o.games).filter(g => g && typeof g.id === 'string' && typeof g.title === 'string').map(g => ({ id: g.id, title: g.title, tags: arr(g.tags) })),
    adult: o.adult === true, musicApp: typeof o.musicApp === 'string' ? o.musicApp : '', favorites: arr(o.favorites), blocked: arr(o.blocked) };
};
// P es un único objeto compartido: se reemplaza su contenido, nunca la referencia, para que todos los módulos lo vean al día.
export const P = fresh();
export function setProfile(next) {
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, clean(next));
}

// Sin cuenta el perfil vive solo en esta visita (en memoria); con cuenta se guarda en el servidor.
// El servidor numera cada versión (P.rev): si otro dispositivo guardó antes, rechaza la escritura vieja (409) y acá se adopta lo nuevo.
let saveTimer;
async function push() {
  if (!session.user) return;
  try {
    const r = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: P, base: P.rev || 0 }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) P.rev = d.rev;
    else if (r.status === 409 && d.profile) { setProfile(d.profile); dispatchEvent(new CustomEvent('pulso:conflict')); }
  } catch {}
}
export function save() { // se guarda 0,8 s después del último cambio
  clearTimeout(saveTimer); saveTimer = setTimeout(push, 800);
}
export const addEvent = (tag, w) => (P.tags[tag] ??= []).push({ w, t: Date.now() });

// Cada interacción suma o resta peso a las etiquetas del ítem (género, artista, plataforma…): así el perfil se afina solo.
// Pesos: me gusta +4 · terminar una canción +2 · reproducir/abrir +1/+2 · saltar −1 · "no me interesa" −4.
export function learn(item, w) {
  for (const t of item?.tags || []) {
    const events = (P.tags[t] ??= []);
    events.push({ w, t: Date.now() });
    if (events.length > 40) { // compacta el historial viejo en un solo evento equivalente
      const old = events.splice(0, events.length - 20), at = old.at(-1).t;
      events.unshift({ w: old.reduce((a, e) => a + decay(e.w, e.t, at), 0), t: at });
    }
  }
  save();
}

// Bandas: se guardan con su nombre y suman peso fuerte a su etiqueta de artista (+8).
export function setBands(next) {
  const was = new Set(P.bands.map(normName)), now = new Map(next.map(b => [normName(b), b]));
  for (const n of now.keys()) if (!was.has(n)) addEvent('artist:' + n, 8);
  for (const n of was) if (!now.has(n)) addEvent('artist:' + n, -Math.max(0, weight('artist:' + n, P)));
  P.bands = [...now.values()]; save();
}

// Juegos que la persona cargó a mano ({ id, title, tags }): suman peso a sus géneros/plataformas, igual que las bandas a sus artistas.
export function setGames(next) {
  const was = new Map(P.games.map(g => [g.id, g])), now = new Map(next.map(g => [g.id, g]));
  for (const [id, g] of now) if (!was.has(id)) for (const t of g.tags) addEvent(t, 3);
  for (const [id, g] of was) if (!now.has(id)) for (const t of g.tags) addEvent(t, -3);
  P.games = [...now.values()]; save();
}

// Etiquetas con peso positivo bajo un prefijo, de mayor a menor: [[clave, peso], …]
export const topWeights = (prefix, n, min = 0.5) =>
  Object.keys(P.tags).filter(k => k.startsWith(prefix)).map(k => [k.slice(prefix.length), weight(k, P)])
    .filter(x => x[1] > min).sort((a, b) => b[1] - a[1]).slice(0, n);
export const topKeys = (prefix, n, min) => topWeights(prefix, n, min).map(x => x[0]);

// Etiqueta -> texto legible. Los artistas usan el nombre tal como lo escribió la persona.
const OVERRIDES = { soundtrack: 'Banda sonora', 'música latina': 'Latino', 'singer/songwriter': 'Cantautor' };
const titleCase = t => String(t).replace(/(^|\s)\S/g, c => c.toUpperCase());
export function label(tag) {
  const name = tag.split(':').slice(1).join(':');
  if (tag.startsWith('artist:')) return P.bands.find(b => normName(b) === name) || titleCase(name);
  return OVERRIDES[name] || tagLabel(tag);
}
export const list = tags => tags.map(label).join(', ');
