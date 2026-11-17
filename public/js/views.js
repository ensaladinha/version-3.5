// Las pantallas: Inicio, Música, Juegos, Series, Búsqueda y Perfil.
// Cada vista recibe (arg, ctx). ctx.alive() dice si la navegación sigue en esta pantalla: si la persona ya fue a otra,
// la respuesta tardía se descarta en vez de pisar la pantalla nueva.
import { $, $$, ago, api, enc, esc, svg, toast, unique } from './util.js';
import { P, label, list, session, setBands, setGames, setProfile, save, topKeys, topWeights, addEvent } from './state.js';
import { buildFeed, discover, weight } from './recommender.js';
import { isAdult, normName, MUSIC_GENRES, GAME_GENRES, PLATFORMS, MEDIA_GENRES } from './shared.js';
import { CAT, card, grid, heroCard, isRecent, miniCard, newCard, rankRows } from './cards.js';
import { Q, setPlaying } from './player.js';
import { bandsEditor, gamesBoxHtml, gamesEditor, onboarding } from './onboarding.js';
import { PLATFORMS as MUSIC_APPS } from './platforms.js';
import { openDialog, closeDialog, focusDialog } from './dialog.js';

// ---------- carga de datos ----------
// Se oculta lo que la persona bloqueó y, salvo que haya activado el permiso de adultos en Perfil, el contenido +18.
const shown = i => !P.blocked.includes(i.id) && (P.adult || !isAdult(i));
const MEMO = new Map(); // las respuestas se recuerdan 5 min: navegar entre secciones no vuelve a pedir lo mismo
async function load(path) {
  try {
    let m = MEMO.get(path);
    if (!m || m.exp < Date.now()) {
      m = { v: await api(path), exp: Date.now() + 300000 };
      if (MEMO.size >= 100) for (const [k, e] of MEMO) if (e.exp < Date.now() || MEMO.size >= 100) MEMO.delete(k); // sin crecer sin límite
      MEMO.set(path, m);
    }
    return m.v.filter(shown);
  } catch { return null; } // null = "no se pudo cargar" (distinto de [] = "no hay nada")
}
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback()), ms))]); // fallback es una función: así quien llama se entera de que se agotó el tiempo
// La portada llega en un solo pedido (/api/home) con la hora real en que el servidor la armó y qué fuentes fallaron.
async function loadHome() {
  const none = { generatedAt: Date.now(), failed: ['todas las fuentes'], lists: { ch: null, nw: null, tr: null, nu: null, up: null, gt: null } };
  try {
    let m = MEMO.get('home');
    if (!m || m.exp < Date.now()) { m = { v: await api('home'), exp: Date.now() + 300000 }; MEMO.set('home', m); }
    const d = m.v, ok = l => l ? l.filter(shown) : null;
    return { generatedAt: d.generatedAt || Date.now(), failed: d.failed || [], lists: { ch: ok(d.charts), nw: ok(d.news), tr: ok(d.trending), nu: ok(d.fresh), up: ok(d.upcoming), gt: ok(d.hot) } };
  } catch { return none; }
}
const dayJitter = n => { let h = Math.floor(Date.now() / 864e5); for (const c of n) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 300) / 100; };
const rank = (l, n) => buildFeed(unique(l), P, n);
// Toma hasta n ítems que no se hayan mostrado antes en la página (así no se repiten entre secciones).
const take = (l, n, seen) => { const o = []; for (const i of l) if (!seen.has(i.id)) { seen.add(i.id); o.push(i); if (o.length >= n) break; } return o; };
// Como take, pero si dedupe dejaría la sección casi vacía (menos de 4), muestra la lista completa.
const takeKeep = (l, n, seen) => {
  const r = l.filter(i => !seen.has(i.id));
  if (r.length >= Math.min(4, l.length)) return take(r, n, seen);
  const o = l.slice(0, n); o.forEach(i => seen.add(i.id)); return o;
};

// ---------- contenido a medida según los gustos ----------
async function personalMusic() {
  const cand = new Set([...P.bands.map(normName), ...topKeys('artist:', 10, 2).filter(a => !/ & |,| feat\.? | ft\.? /.test(a))]);
  const names = [...cand].map(a => [a, weight('artist:' + a, P) + dayJitter(a)]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0].replace(/,/g, '')).sort();
  const genres = topKeys('genre:', 3).filter(g => g in MUSIC_GENRES), q = enc(names.join(','));
  const [byGenre, mine, similar] = await Promise.all([
    Promise.all(genres.map(async g => [g, (await load(`music/genre?g=${enc(g)}`)) || []])),
    names.length ? load(`music/artists?names=${q}`) : null, names.length ? load(`music/similar?names=${q}`) : null]);
  return { genres: byGenre, artists: mine || [], similar: similar || [], names };
}
async function personalGames() {
  const genres = topKeys('gamegenre:', 3).filter(g => g in GAME_GENRES), plats = topKeys('platform:', 3).filter(p => p in PLATFORMS);
  const [games, news] = await Promise.all([Promise.all(genres.map(g => load(`games/genre?g=${enc(g)}`))), Promise.all([...plats, 'all'].map(p => load(`games/feed?p=${enc(p)}`)))]);
  return { games: games.flatMap(l => l || []), news: news.flatMap(l => l || []), genres, plats };
}
const personalMedia = async () => ({ genres: await Promise.all(topKeys('mediagenre:', 3).filter(g => g in MEDIA_GENRES).map(async g => [g, (await load(`media/genre?g=${enc(g)}`)) || []])) });

// ---------- piezas de HTML ----------
const retry = '<button type="button" class="edl" data-retry>Reintentar</button>';
const sect = (title, l) => `<h2>${title}</h2>` + (l ? grid(l) : `<p class="m empty">No se pudo cargar esta sección. ${retry}</p>`);
const block = (title, sub, l) => l.length ? `<h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}${grid(l)}` : '';
const sub = (likes, none) => likes ? 'Porque te gusta: ' + likes : none;
const NONE_HINT = 'Elegí tus gustos en Perfil para personalizar esta página.';
const NONE = { genres: [], artists: [], similar: [], games: [], news: [] };

function withSearch(ctx, placeholder, path, body) {
  if (!ctx.alive()) return;
  $('#view').innerHTML = `<label class="sr" for="q">${esc(placeholder)}</label><input id="q" type="search" placeholder="${esc(placeholder)}" autocomplete="off"><div id="res" aria-live="polite"></div><div id="base">${body}</div>`;
  let timer, seq = 0;
  $('#q').oninput = e => {
    clearTimeout(timer); const q = e.target.value.trim(), mine = ++seq;
    timer = setTimeout(async () => {
      $('#base').hidden = !!q; if (!q) { $('#res').innerHTML = ''; return; }
      $('#res').innerHTML = '<div class="grid">' + '<div class="sk card"></div>'.repeat(4) + '</div>';
      const r = await load(`${path}?q=${enc(q)}`);
      if (mine !== seq) return; // llegó tarde: ya se escribió otra cosa
      $('#res').innerHTML = r ? (r.length ? grid(r) : '<p class="m empty">No encontramos nada. Probá con otro término.</p>') : `<p class="m empty">No se pudo buscar ahora. ${retry}</p>`;
    }, 400);
  };
}

export const V = {
  async home(_, ctx) {
    let late = false; // la personalización tardó más de 6 s y se descartó: se avisa en vez de callarlo
    const [home, [pm, pg, pmd]] = await Promise.all([loadHome(),
      withTimeout(Promise.all([personalMusic(), personalGames(), personalMedia()]), 6000, () => { late = true; return [NONE, NONE, NONE]; })]);
    if (!ctx.alive()) return;
    const { ch, nw, tr, nu, up, gt } = home.lists;
    Q.chart = ch || []; if (!Q.list.length) Q.list = Q.chart;
    const hs = [ch?.[0] && heroCard(ch[0], `${ch[0].artist || ''} · Top Argentina`), (nw?.[0] || gt?.[0]) && heroCard(nw?.[0] || gt[0]), (nu?.[0] || tr?.[0]) && heroCard(nu?.[0] || tr[0])].filter(Boolean);
    const roundRobin = (arrs, n) => { const o = []; for (let i = 0; i < 8; i++) arrs.forEach(x => x[i] && o.length < n && o.push(x[i])); return o; };
    const recentMusic = (() => { const r = (ch || []).filter(isRecent).sort((a, b) => b.publishedAt - a.publishedAt); return (r.length >= 3 ? r : (ch || [])).slice(0, 8); })();
    const NEW = { music: recentMusic, games: [...(nw || []).slice(0, 5), ...(up || []).slice(0, 3)], media: (nu || []).slice(0, 8) };
    NEW.all = roundRobin([NEW.music, NEW.games, NEW.media], 8);
    const pool = unique([...(ch || []), ...(nw || []), ...(up || []), ...(nu || []), ...(tr || []), ...(gt || []),
      ...pm.artists, ...pm.similar, ...pm.genres.flatMap(g => g[1]), ...pg.games, ...pg.news, ...pmd.genres.flatMap(g => g[1])]);
    const tops = [...new Set(Object.keys(P.tags).filter(k => !k.startsWith('platform:')).map(k => [k, weight(k, P)]).filter(x => x[1] > 0.5).sort((x, y) => y[1] - x[1]).slice(0, 4).map(x => label(x[0])))].slice(0, 3);
    const forYou = buildFeed(pool, P, 12), found = discover(pool, P, 8, new Set(forYou.map(i => i.id)));
    const col = (c, t, l) => `<section class="tcol cat-${c}"><h3>${t}</h3>${rankRows(l)}</section>`;
    const offer = P.onboardingDone ? '' : `<p class="banner" id="offer">¿Querés una portada a tu medida? Elegí tus gustos en 3 pasos (podés saltarlo). <button type="button" class="edl" id="ob-offer">Elegir mis gustos</button><button type="button" class="edl" id="ob-no">Ahora no</button></p>`;
    const guest = session.user ? '' : '<p class="banner">Estás mirando Pulso sin cuenta. <button type="button" class="edl" data-login>Crear cuenta o acceder</button> para guardar tus gustos y favoritos.</p>';
    $('#view').innerHTML = `<h1 class="hd">Hoy en Pulso</h1><p class="sub">Lo más importante del momento en música, juegos y series. Actualizado <span id="upd" data-t="${home.generatedAt}">${ago(home.generatedAt)}</span>.</p>
${guest}${offer}${home.failed.length ? `<p class="notice" role="status">No respondieron estas fuentes: ${esc(home.failed.join(', '))}. ${retry}</p>` : ''}${late ? `<p class="notice" role="status">Tu selección personalizada tardó demasiado y no llegó a tiempo: por ahora ves la portada general. ${retry}</p>` : ''}
<div class="hero">${hs.join('') || `<p class="m empty">No se pudo cargar el contenido por ahora. ${retry}</p>`}</div>
<div class="sec"><div><h2>Lo nuevo</h2><p class="sub">Estrenos, lanzamientos y noticias recién publicadas.</p></div>
<div class="fl" role="group" aria-label="Filtrar novedades">${[['all', 'Todo'], ['music', 'Música'], ['games', 'Juegos'], ['media', 'Series']].map(([k, l]) => `<button type="button" data-f="${k}">${l}</button>`).join('')}</div></div><div class="ng" id="ng" aria-live="polite"></div>
<div class="sec"><div><h2>Para vos</h2><p class="sub">${tops.length ? 'Porque te gusta: ' + esc(tops.join(', ')) : 'Elegí tus gustos para personalizar tu portada.'}</p></div>
<div class="cr"><button type="button" class="ar" id="cl" aria-label="Anterior">${svg('<path d="m15 18-6-6 6-6"/>', 20)}</button><button type="button" class="ar" id="cn" aria-label="Siguiente">${svg('<path d="m9 18 6-6-6-6"/>', 20)}</button><button type="button" class="edl" id="edg">Editar mis gustos</button></div></div>
<div class="car" role="group" aria-label="Recomendados para vos">${pool.length ? forYou.map(i => miniCard(i)).join('') : '<p class="m empty">Sin recomendaciones por ahora.</p>'}</div>
<div class="sec"><div><h2>Descubrí algo nuevo</h2><p class="sub">Cerca de lo que te gusta, pero que todavía no exploraste.</p></div></div>
<div class="car" role="group" aria-label="Para descubrir">${found.length ? found.map(i => miniCard(i, true)).join('') : '<p class="m empty">Cuando haya más novedades, vas a ver acá cosas para explorar.</p>'}</div>
<div class="sec"><h2>Tendencias ahora</h2></div>
<div class="tg">${col('music', 'Música · Top Argentina', ch)}${col('games', 'Juegos · Lo más comentado', gt)}${col('media', 'Series y películas · Esta semana', tr)}</div>`;
    const draw = f => {
      $('#ng').innerHTML = NEW[f].length ? NEW[f].map(newCard).join('') : '<p class="m empty">No hay novedades en esta categoría.</p>';
      $$('.fl button').forEach(b => { b.classList.toggle('on', b.dataset.f === f); b.setAttribute('aria-pressed', b.dataset.f === f); });
    };
    $$('.fl button').forEach(b => b.onclick = () => draw(b.dataset.f)); draw('all');
    $('#edg').onclick = onboarding;
    $('#ob-offer')?.addEventListener('click', onboarding);
    $('#ob-no')?.addEventListener('click', () => { P.onboardingDone = true; save(); $('#offer').remove(); });
    $$('[data-login]').forEach(b => b.onclick = () => dispatchEvent(new Event('pulso:login')));
    $('#cl').onclick = () => $('.car').scrollBy({ left: -480, behavior: 'smooth' });
    $('#cn').onclick = () => $('.car').scrollBy({ left: 480, behavior: 'smooth' });
    setPlaying();
  },
  async search(q, ctx) {
    const e = enc(q), head = `<h1 class="h2like">Resultados para “${esc(q)}”</h1>`;
    $('#view').innerHTML = head + skeletonGrid();
    const [m, g, s] = await Promise.all([`music/search?q=${e}`, `games/search?q=${e}`, `media/search?q=${e}`].map(load));
    if (ctx.alive()) $('#view').innerHTML = head + sect('Música', m) + sect('Juegos', g) + sect('Series y películas', s);
  },
  async music(_, ctx) {
    const [ch, pm] = await Promise.all([load('music/charts'), personalMusic()]);
    if (!ctx.alive()) return;
    const seen = new Set(), songs = l => buildFeed(unique(l), P, 40);
    const pool = unique([...pm.artists, ...pm.similar, ...pm.genres.flatMap(g => g[1]), ...(ch || [])]);
    const likes = topKeys('genre:', 3).map(g => label('genre:' + g)), mine = pm.names.map(n => label('artist:' + n));
    let html = pageTitle('Música') + block('Para vos', sub([...likes, ...mine].join(', '), NONE_HINT), take(rank(pool, 16), 8, seen));
    html += block('De tus bandas', 'Canciones de ' + mine.join(', '), takeKeep(songs(pm.artists), 8, seen));
    html += block('Si te gusta ' + mine.slice(0, 2).join(' y ') + ', probá con…', 'Artistas parecidos', takeKeep(songs(pm.similar), 8, seen));
    pm.genres.forEach(([g, l]) => { html += block('Lo mejor de ' + label('genre:' + g), '', takeKeep(songs(l), 8, seen)); });
    withSearch(ctx, 'Buscar canciones, artistas o álbumes…', 'music/search', html + sect('Top Argentina', ch));
  },
  async games(_, ctx) {
    const [nw, up, pg] = await Promise.all([load('games/news'), load('games/upcoming'), personalGames()]);
    if (!ctx.alive()) return;
    const gl = list(pg.genres.map(g => 'gamegenre:' + g)), pl = list(pg.plats.map(p => 'platform:' + p));
    const subtitle = gl || pl ? 'Porque te gusta: ' + (gl || 'juegos') + (pl ? ' en ' + pl : '') : NONE_HINT;
    const news = take(rank([...(nw || []), ...pg.news], 18), 18, new Set());
    withSearch(ctx, 'Buscar un juego…', 'games/search', pageTitle('Videojuegos') + block('Noticias para vos', subtitle, news)
      + block('Juegos para vos', subtitle, take(rank([...pg.games, ...(up || [])], 12), 12, new Set()))
      + (up?.length ? block('Lanzamientos próximos', '', rank(up, 12)) : sect('Lanzamientos próximos', up)));
  },
  async media(_, ctx) {
    const [nu, tr, pm] = await Promise.all([load('media/new'), load('media/trending'), personalMedia()]);
    if (!ctx.alive()) return;
    const seen = new Set(), likes = list(pm.genres.map(([g]) => 'mediagenre:' + g));
    const pool = unique([...pm.genres.flatMap(g => g[1]), ...(nu || []), ...(tr || [])]);
    let html = pageTitle('Series y películas') + block('Para vos', sub(likes, NONE_HINT), take(rank(pool, 16), 12, seen));
    pm.genres.forEach(([g, l]) => { html += block('Lo mejor de ' + label('mediagenre:' + g), '', takeKeep(rank(l, 8), 8, seen)); });
    withSearch(ctx, 'Buscar películas o series…', 'media/search', html + sect('Lo nuevo', nu) + sect('En tendencia', tr));
  },
  profile(_, ctx) {
    if (!ctx.alive()) return;
    if (!session.user) { // sin cuenta no hay perfil que mostrar: se ofrece crearla (sin abrir el acceso solo, para no entrar en un bucle)
      $('#view').innerHTML = `<h1 class="h2like">Mi perfil</h1><p class="sub">Para ver y guardar tus gustos, bandas, juegos y favoritos necesitás una cuenta. Es gratis.</p><p class="row"><button type="button" class="pri" data-login>Crear cuenta o acceder</button> <a class="btn" href="#/">Volver al inicio</a></p>`;
      $$('[data-login]').forEach(b => b.onclick = () => dispatchEvent(new Event('pulso:login'))); return;
    }
    // Cada fila es una etiqueta con su puntaje: sube con ♥, clics y reproducciones; baja con "no me interesa" o saltar.
    const rows = (prefix, n = 8) => {
      const t = topWeights(prefix, n), max = Math.max(...t.map(x => x[1]), 1);
      return t.length ? `<ul class="bars">${t.map(([k, w]) => `<li><span>${esc(label(prefix + k))}</span><i data-w="${Math.round(w / max * 100)}" aria-hidden="true"></i><b>${w.toFixed(1)}</b></li>`).join('')}</ul>`
        : '<p class="m">Todavía nada: mirá, escuchá y dale ♥ a cosas para que aparezcan.</p>';
    };
    $('#view').innerHTML = `<h1 class="h2like">Mis gustos</h1><p class="sub">Estos puntajes cambian con todo lo que hacés: ♥ y escuchar suman, saltar y “No me interesa” restan. Con eso se ordena tu portada.</p>
<div class="tg"><section class="tcol cat-music"><h3>Música</h3>${rows('genre:')}<h4>Artistas</h4>${rows('artist:', 6)}</section>
<section class="tcol cat-games"><h3>Videojuegos</h3>${rows('gamegenre:')}<h4>Plataformas</h4>${rows('platform:')}</section>
<section class="tcol cat-media"><h3>Series y películas</h3>${rows('mediagenre:')}</section></div>
<h2>Mis bandas</h2><p class="sub">Te mostramos sus canciones y las de artistas parecidos.</p>
<div class="bandin"><input id="bin" maxlength="60" placeholder="Agregar una banda o artista…" aria-label="Agregar banda o artista" autocomplete="off"><button type="button" class="pri" id="badd">Agregar</button></div><ul class="bchips" id="bchips"></ul>
${gamesBoxHtml()}
<h2>Escuchar canciones completas</h2><p class="sub">El botón «Completa» de cada canción la abre en tu app de música.</p>
<div class="fld"><label for="mapp">Mi app de música</label><select id="mapp"><option value="">Preguntarme cada vez</option>${MUSIC_APPS.map(p => `<option value="${p.id}" ${P.musicApp === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
<p class="row"><button type="button" id="ob">Editar gustos</button> <button type="button" id="exp">Exportar mis datos</button> <button type="button" id="del" class="danger">Borrar mis gustos y favoritos</button></p>
<h2>Contenido para adultos</h2>
<label class="rem"><input type="checkbox" id="adult" ${P.adult ? 'checked' : ''}><span>Mostrar novedades y juegos para adultos (+18). Confirmo que tengo 18 años o más.</span></label>
<p class="m">Si está desactivado, ocultamos las noticias y los juegos con contenido sexual, violento o solo para mayores.</p>
<h2>Cuenta</h2><p>${esc(session.user.name)} · <span class="m">${esc(session.user.email)}</span></p>
<p class="row"><button type="button" id="out">Cerrar sesión</button> <button type="button" id="outall">Cerrar sesión en todos los dispositivos</button> <button type="button" id="delacc" class="danger">Eliminar mi cuenta</button></p>
<h2>Favoritos</h2>${grid(P.favorites)}`;
    $$('.bars i').forEach(i => i.style.setProperty('--w', i.dataset.w + '%')); // por CSSOM: la CSP no permite estilos en línea
    bandsEditor({ get: () => P.bands, set: setBands, redraw: () => V.profile(null, ctx), root: '#view' });
    gamesEditor({ get: () => P.games, set: setGames, redraw: () => V.profile(null, ctx), root: '#view' });
    $('#adult').onchange = e => { P.adult = e.target.checked; save(); toast(P.adult ? 'Listo: vas a ver también contenido para adultos.' : 'Listo: ocultamos el contenido para adultos.'); };
    $('#mapp').onchange = e => { P.musicApp = e.target.value; save(); toast(P.musicApp ? 'Listo: «Completa» abre esa app directo.' : 'Listo: te vamos a preguntar cada vez.'); };
    $('#ob').onclick = onboarding;
    $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(P, null, 2)], { type: 'application/json' })); a.download = 'pulso-datos.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    $('#del').onclick = () => { if (confirm('¿Borrar tus gustos, bandas, juegos y favoritos? Tu cuenta sigue existiendo. Esto no se puede deshacer.')) { setProfile(null); save(); dispatchEvent(new Event('pulso:render')); } };
    $('#out').onclick = () => dispatchEvent(new Event('pulso:logout'));
    $('#outall').onclick = async () => {
      const r = await fetch('/api/auth/logout-all', { method: 'POST' }).catch(() => null);
      if (r?.ok) { toast('Cerramos tu sesión en todos los dispositivos.'); dispatchEvent(new Event('pulso:signed-out')); } else toast('No se pudo cerrar las sesiones. Probá de nuevo.');
    };
    $('#delacc').onclick = deleteAccount;
  }
};
// Borrado real: el servidor elimina email, nombre, contraseña, perfil y sesiones. Pide la contraseña para confirmar.
function deleteAccount() {
  const m = $('#modal');
  m.innerHTML = `<form class="box" id="daf" role="dialog" aria-modal="true" aria-labelledby="da-t" novalidate><h2 id="da-t" tabindex="-1">Eliminar mi cuenta</h2>
<p>Se borran para siempre tu email, tu nombre, tu contraseña, tus gustos y tus favoritos. No se puede deshacer.</p>
<div class="fld" id="f-dapw"><label for="dapw">Escribí tu contraseña para confirmar</label><input id="dapw" type="password" autocomplete="current-password" required aria-describedby="e-dapw"><small class="er" id="e-dapw" role="alert"></small></div>
<div class="foot"><button type="button" class="ghost" id="da-x">Cancelar</button><button type="submit" class="danger">Eliminar cuenta</button></div></form>`;
  openDialog(closeDialog); focusDialog('#dapw');
  $('#da-x').onclick = closeDialog;
  $('#daf').onsubmit = async e => {
    e.preventDefault(); const pw = $('#dapw').value, er = t => { $('#e-dapw').textContent = t; $('#f-dapw').classList.toggle('bad', !!t); };
    if (!pw) { er('Error: ingresá tu contraseña'); return $('#dapw').focus(); }
    const btn = e.submitter; btn.disabled = true;
    const r = await fetch('/api/auth/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }).catch(() => null);
    btn.disabled = false;
    if (!r) { er('Error: no hay conexión con el servidor'); return; }
    if (!r.ok) { er((await r.json().catch(() => ({}))).error || 'Error: no se pudo eliminar la cuenta'); return $('#dapw').focus(); }
    closeDialog(); toast('Tu cuenta fue eliminada.'); dispatchEvent(new Event('pulso:signed-out'));
  };
}
const pageTitle = t => `<h1 class="h2like">${t}</h1>`;

// ---------- esqueletos de carga (en vez de "Cargando…") ----------
const skeletonGrid = (n = 8) => `<div class="grid" aria-hidden="true">${'<div class="sk card"></div>'.repeat(n)}</div>`;
export const skeleton = name => name === 'home'
  ? `<div aria-hidden="true"><div class="sk sk-t"></div><div class="sk sk-s"></div><div class="hero"><div class="sk sk-h"></div><div class="sk sk-h"></div><div class="sk sk-h"></div></div><div class="ng">${'<div class="sk card"></div>'.repeat(4)}</div></div>`
  : `<div aria-hidden="true"><div class="sk sk-t"></div>${skeletonGrid()}</div>`;
export const errorState = () => `<div class="errbox" role="alert"><h1 class="h2like">Algo salió mal</h1><p class="m">No pudimos mostrar esta pantalla. Puede ser un problema de conexión.</p><p><button type="button" class="pri" data-retry>Reintentar</button> <a class="btn" href="#/">Ir al inicio</a></p></div>`;
