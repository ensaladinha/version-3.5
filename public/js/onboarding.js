// Elegir gustos (3 pasos) y los campos de bandas y de juegos que también usa el Perfil.
import { $, api, enc, esc, ico, toast } from './util.js';
import { P, addEvent, save, session, setBands, setGames } from './state.js';
import { normName, gameTagsFromText, MUSIC_GENRES, GAME_GENRES, PLATFORMS, MEDIA_GENRES } from './shared.js';
import { openDialog, closeDialog, focusDialog } from './dialog.js';

const opts = o => Object.entries(o).map(([k, v]) => [k, v.label]);
// Cada paso: grupos de opciones [clave, texto]. "p" es el prefijo de etiqueta del dominio (ver shared.js).
// Sin emojis: se ven distinto en cada sistema y rompen la coherencia con el resto de los íconos (SVG).
const STEPS = [
  { c: 'music', icon: ico.music, name: 'Música', q: '¿Qué música te gusta?', groups: [{ p: 'genre', o: opts(MUSIC_GENRES) }] },
  { c: 'games', icon: ico.games, name: 'Juegos', q: '¿Qué juegos te interesan?', groups: [
    { l: 'Géneros', p: 'gamegenre', o: opts(GAME_GENRES) },
    { l: 'Plataformas', p: 'platform', o: opts(PLATFORMS) }] },
  { c: 'media', icon: ico.media, name: 'Series y películas', q: '¿Qué te gusta mirar?', groups: [{ p: 'mediagenre', o: opts(MEDIA_GENRES) }] }
];
const posSum = tag => (P.tags[tag] || []).reduce((s, e) => s + e.w, 0);

/** Campo para escribir bandas con sus chips. Enter o coma agregan; se aceptan listas pegadas ("Coldplay, Muse").
 *  root: contenedor donde viven los campos ('#modal' en los gustos, '#view' en el Perfil), porque los ids se repiten. */
export function bandsEditor({ get, set, redraw, root = '#view' }) {
  const q = s => $(root + ' ' + s), input = q('#bin'), box = q('#bchips'), MAX = 15;
  const chips = () => {
    box.innerHTML = get().map((b, i) => `<li class="bchip">${esc(b)}<button type="button" data-rm="${i}" aria-label="Quitar ${esc(b)}">×</button></li>`).join('');
    box.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { const n = get().slice(); n.splice(+x.dataset.rm, 1); set(n); chips(); redraw?.(); });
  };
  const add = () => {
    const names = input.value.split(/[,;\n]/).map(x => x.trim().slice(0, 60)).filter(Boolean); if (!names.length) return;
    const n = get().slice();
    for (const x of names) if (n.length < MAX && !n.some(b => normName(b) === normName(x))) n.push(x);
    if (get().length + names.length > MAX && n.length >= MAX) toast('Podés tener hasta ' + MAX + ' bandas.');
    input.value = ''; set(n); chips(); redraw?.(); q('#bin')?.focus();
  };
  input.onkeydown = e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } };
  q('#badd').onclick = add; chips();
  return add; // para guardar lo que quedó escrito sin apretar "Agregar"
}

/** Caja de HTML para cargar bandas (la usa el paso de Música y el Perfil). */
export const bandsBoxHtml = (hidden = false) => `<section class="bands" id="bands" ${hidden ? 'hidden' : ''}><h3>Tus bandas y artistas</h3>
<p class="m">Escribí las que más te gusten (Enter o coma para agregar). Te mostramos sus canciones y las de artistas parecidos.</p>
<div class="bandin"><input id="bin" maxlength="60" placeholder="Ej: Coldplay, Soda Stereo, Bad Bunny…" aria-label="Agregar banda o artista" autocomplete="off"><button type="button" class="pri" id="badd">Agregar</button></div><ul class="bchips" id="bchips"></ul></section>`;

/** Caja de HTML para cargar juegos concretos (paso de Juegos y Perfil). */
export const gamesBoxHtml = () => `<section class="bands" id="gamesbox"><h3>Tus juegos favoritos</h3>
<p class="m">Buscá un juego y elegilo de la lista (o escribí el nombre y apretá Enter). Con eso afinamos tus recomendaciones.</p>
<div class="bandin"><input id="gin" maxlength="80" placeholder="Ej: Hades, Elden Ring, FC 26…" aria-label="Agregar un juego" autocomplete="off" aria-controls="gsug"><button type="button" class="pri" id="gadd">Agregar</button></div>
<ul class="gsug" id="gsug" aria-label="Sugerencias de juegos" aria-live="polite"></ul><ul class="bchips" id="gchips"></ul></section>`;

/** Carga manual de juegos: busca en Steam mientras se escribe y guarda { id, title, tags } para alimentar el recomendador. */
export function gamesEditor({ get, set, redraw, root = '#view' }) {
  const q = s => $(root + ' ' + s), input = q('#gin'), box = q('#gchips'), sug = q('#gsug'), MAX = 20, found = new Map();
  let seq = 0, timer;
  const chips = () => {
    box.innerHTML = get().map((g, i) => `<li class="bchip">${esc(g.title)}<button type="button" data-rm="${i}" aria-label="Quitar ${esc(g.title)}">×</button></li>`).join('');
    box.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { const n = get().slice(); n.splice(+x.dataset.rm, 1); set(n); chips(); redraw?.(); });
  };
  const addGame = g => {
    const n = get().slice();
    if (n.some(x => x.id === g.id)) return;
    if (n.length >= MAX) return toast('Podés tener hasta ' + MAX + ' juegos.');
    n.push(g); set(n); chips(); redraw?.();
  };
  const clear = () => { input.value = ''; sug.innerHTML = ''; seq++; };
  const fromItem = it => ({ id: it.id, title: it.title, tags: (it.tags || []).filter(t => t.startsWith('gamegenre:') || t.startsWith('platform:')).slice(0, 6) });
  const addTyped = () => { // Enter o "Agregar": si coincide con una sugerencia se usa esa (trae géneros); si no, el texto tal cual
    const t = input.value.trim().slice(0, 80); if (!t) return;
    const hit = [...found.values()].find(it => normName(it.title) === normName(t));
    addGame(hit ? fromItem(hit) : { id: 'manual:' + normName(t), title: t, tags: gameTagsFromText(t) });
    clear(); q('#gin')?.focus();
  };
  input.oninput = () => {
    clearTimeout(timer); const text = input.value.trim(), mine = ++seq;
    if (text.length < 2) { sug.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api('games/search?q=' + enc(text)); if (mine !== seq) return; // llegó tarde: ya se escribió otra cosa
        const items = r.slice(0, 6); items.forEach(it => found.set(it.id, it));
        sug.innerHTML = items.map(it => `<li><button type="button" data-g="${esc(it.id)}">${esc(it.title)}<small>${esc(it.subtitle || '')}</small></button></li>`).join('');
      } catch { if (mine === seq) sug.innerHTML = ''; } // si no hay búsqueda, igual se puede agregar a mano con Enter
    }, 350);
  };
  sug.onclick = e => { const b = e.target.closest('[data-g]'); if (!b || !found.has(b.dataset.g)) return; addGame(fromItem(found.get(b.dataset.g))); clear(); q('#gin')?.focus(); };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } };
  q('#gadd').onclick = addTyped; chips();
  return addTyped; // para guardar lo que quedó escrito sin apretar "Agregar"
}

export function onboarding() {
  const sel = new Set(); let step = 0, bands = [...P.bands], games = [...P.games], commitBand = () => {}, commitGame = () => {};
  STEPS.forEach(s => s.groups.forEach(g => g.o.forEach(([k]) => posSum(`${g.p}:${k}`) > 0 && sel.add(`${s.c}|${g.p}:${k}`))));
  const m = $('#modal');
  const close = () => { P.onboardingDone = true; save(); closeDialog(); };
  const finish = () => {
    commitBand(); commitGame(); setBands(bands); setGames(games);
    const want = new Set([...sel].map(k => k.split('|')[1])), all = STEPS.flatMap(s => s.groups.flatMap(g => g.o.map(([k]) => `${g.p}:${k}`)));
    for (const tag of all) { const pos = posSum(tag) > 0; if (want.has(tag) && !pos) addEvent(tag, 5); else if (!want.has(tag) && pos) addEvent(tag, -posSum(tag)); }
    close(); dispatchEvent(new Event('pulso:render'));
    if (!session.user) toast('Tus gustos valen solo en esta visita. Creá una cuenta para guardarlos.', { label: 'Crear cuenta', run: () => dispatchEvent(new Event('pulso:login')) });
  };
  const count = () => { const n = [...sel].filter(k => k.startsWith(STEPS[step].c + '|')).length; return n ? `${n} elegido${n > 1 ? 's' : ''}` : 'Elegí los que quieras'; };
  const musicPicked = () => [...sel].some(k => k.startsWith('music|')) || bands.length > 0;

  function draw(focus) {
    const s = STEPS[step];
    m.innerHTML = `<div class="box ob" data-c="${s.c}" role="dialog" aria-modal="true" aria-labelledby="ob-t">
<ol class="steps" aria-label="Paso ${step + 1} de ${STEPS.length}">${STEPS.map((x, i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}" ${i === step ? 'aria-current="step"' : ''}><b>${i < step ? '✓' : i + 1}</b><span>${x.name}</span></li>`).join('')}</ol>
<h2 id="ob-t" tabindex="-1">${s.icon} ${s.q}</h2><p class="m">Tocá todo lo que te guste. Con esto armamos tu portada y las recomendaciones; podés cambiarlo cuando quieras en Perfil.</p>
${s.groups.map(g => `<fieldset class="grp">${g.l ? `<legend>${g.l}</legend>` : `<legend class="sr">${s.name}</legend>`}<div class="tiles">${g.o.map(([k, l]) => {
  const key = `${s.c}|${g.p}:${k}`;
  return `<label class="tile"><input type="checkbox" data-k="${esc(key)}" ${sel.has(key) ? 'checked' : ''}><span class="l">${esc(l)}</span></label>`;
}).join('')}</div></fieldset>`).join('')}
${s.c === 'music' ? bandsBoxHtml(!musicPicked()) : ''}${s.c === 'games' ? gamesBoxHtml() : ''}
<div class="foot"><button class="ghost" id="skb">Saltar</button><span class="cnt m" aria-live="polite">${count()}</span>${step ? '<button class="ghost" id="bk">← Atrás</button>' : ''}<button class="pri" id="nx">${step < STEPS.length - 1 ? 'Siguiente →' : 'Listo ✓'}</button></div></div>`;
    m.querySelectorAll('input[data-k]').forEach(i => i.onchange = () => {
      i.checked ? sel.add(i.dataset.k) : sel.delete(i.dataset.k);
      m.querySelector('.cnt').textContent = count(); const b = $('#modal #bands'); if (b) b.hidden = !musicPicked();
    });
    commitBand = s.c === 'music' ? bandsEditor({ get: () => bands, set: n => { bands = n; }, root: '#modal' }) : () => {};
    commitGame = s.c === 'games' ? gamesEditor({ get: () => games, set: n => { games = n; }, root: '#modal' }) : () => {};
    $('#skb').onclick = close;
    $('#bk')?.addEventListener('click', () => { commitBand(); commitGame(); step--; draw(); });
    $('#nx').onclick = () => { commitBand(); commitGame(); step < STEPS.length - 1 ? (step++, draw()) : finish(); };
    focusDialog(focus || '#ob-t');
  }
  openDialog(close); draw();
}
