// Pantalla de acceso: menú, crear cuenta, iniciar sesión, "olvidé mi contraseña" y elegir una contraseña nueva.
// Ya no es un muro: "Seguir sin cuenta" (onCancel) vuelve a la portada pública.
import { $, svg } from './util.js';

const post = (path, body) => fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => ({ ok: r.ok, status: r.status, ...(await r.json().catch(() => ({}))) }));
const field = (id, label, type, autocomplete, { required = true, hint = '' } = {}) =>
  `<div class="fld" id="f-${id}"><label for="${id}">${label}</label><input id="${id}" type="${type}" autocomplete="${autocomplete}" ${required ? 'required' : ''} aria-describedby="e-${id}${hint ? ' h-' + id : ''}">${hint ? `<small class="hint m" id="h-${id}">${hint}</small>` : ''}<small class="er" id="e-${id}" role="alert"></small></div>`;
const TITLES = { menu: 'Bienvenido', new: 'Crear cuenta', in: 'Acceder', forgot: 'Recuperar contraseña', reset: 'Nueva contraseña' };

export function showAuth(onEnter, mode = 'menu', opts = {}) {
  document.body.classList.add('locked'); const a = $('#auth'); a.hidden = false;
  const logo = `<div class="alogo">${svg('<path d="M2 12h4l3-8 4 16 3-8h6"/>', 28)} Pulso</div>`;
  document.title = TITLES[mode] + ' · Pulso';
  const go = m => () => showAuth(onEnter, m, opts);
  if (mode === 'menu') {
    a.innerHTML = `<div class="abox">${logo}<h1>Tu cuenta en Pulso</h1><p class="m">Con una cuenta guardás tus gustos y favoritos, y tu portada se arma a tu medida en cualquier dispositivo.</p><button class="pri" id="a-new">Crear cuenta</button><button class="ghost" id="a-in">Acceder</button>${opts.onCancel ? '<button class="ghost" id="a-no">Seguir sin cuenta</button>' : ''}</div>`;
    $('#a-new').onclick = go('new'); $('#a-in').onclick = go('in'); if (opts.onCancel) $('#a-no').onclick = opts.onCancel; $('#a-new').focus(); return;
  }
  const err = (id, msg) => { const f = $('#f-' + id); if (!f) return; f.classList.toggle('bad', !!msg); $('#e-' + id).textContent = msg || ''; $('#' + id).setAttribute('aria-invalid', !!msg); };
  const stop = (id, msg) => { err(id, msg); $('#' + id).focus(); };
  const back = '<button class="ghost" type="button" id="a-bk">← Volver</button>';

  if (mode === 'forgot') {
    a.innerHTML = `<form class="abox" id="af" novalidate>${logo}<h1>Recuperar contraseña</h1><p class="m">Escribí tu email y, si tiene una cuenta, te mandamos un enlace para elegir una contraseña nueva.</p>
${field('email', 'Email', 'email', 'email')}<p id="a-msg" class="m" role="status"></p><button class="pri" type="submit">Enviar enlace</button>${back}</form>`;
    $('#a-bk').onclick = go('in'); $('#email').focus(); $('#af').oninput = e => err(e.target.id, '');
    $('#af').onsubmit = async e => {
      e.preventDefault(); const email = $('#email').value.trim(); if (!email) return stop('email', 'Error: ingresá tu email');
      const btn = e.submitter; btn.disabled = true; btn.textContent = 'Un momento…';
      const r = await post('auth/forgot', { email }).catch(() => ({ ok: false, error: 'Error: no hay conexión con el servidor' }));
      btn.disabled = false; btn.textContent = 'Enviar enlace';
      if (!r.ok) return stop('email', r.error || 'Error: probá de nuevo en un momento');
      $('#a-msg').textContent = 'Listo. Si ese email tiene una cuenta, en unos minutos te llega un mensaje con el enlace (revisá también el spam). El enlace vale 1 hora.';
    };
    return;
  }

  const reg = mode === 'new', rst = mode === 'reset';
  a.innerHTML = `<form class="abox" id="af" novalidate>${logo}<h1>${TITLES[mode]}</h1>
${reg ? field('name', 'Nombre (opcional)', 'text', 'name', { required: false }) : ''}${rst ? '' : field('email', 'Email', 'email', 'email')}
${field('password', rst ? 'Contraseña nueva' : 'Contraseña', 'password', reg || rst ? 'new-password' : 'current-password', { hint: reg || rst ? 'Mínimo 8 caracteres.' : '' })}${reg || rst ? field('password2', 'Repetí la contraseña', 'password', 'new-password') : ''}
<button class="pri" type="submit">${rst ? 'Guardar contraseña' : reg ? 'Crear cuenta' : 'Acceder'}</button>${mode === 'in' ? '<button class="edl" type="button" id="a-fg">¿Olvidaste tu contraseña?</button>' : ''}${rst ? '' : back}</form>`;
  if (!rst) $('#a-bk').onclick = go('menu'); if (mode === 'in') $('#a-fg').onclick = go('forgot');
  $(rst ? '#password' : '#email').focus();
  $('#af').oninput = e => err(e.target.id, '');
  $('#af').onsubmit = async e => {
    e.preventDefault(); ['email', 'password', 'password2'].forEach(i => err(i, ''));
    const v = id => $('#' + id)?.value ?? '', email = v('email').trim(), pw = v('password');
    if (!rst && !email) return stop('email', 'Error: ingresá tu email');
    if (!pw) return stop('password', 'Error: ingresá tu contraseña');
    if ((reg || rst) && pw.length < 8) return stop('password', 'Error: la contraseña debe tener al menos 8 caracteres');
    if ((reg || rst) && pw !== v('password2')) return stop('password2', 'Error: las contraseñas no coinciden');
    const label = e.submitter.textContent, btn = e.submitter; btn.disabled = true; btn.textContent = 'Un momento…';
    const r = await post(rst ? 'auth/reset' : reg ? 'auth/register' : 'auth/login', rst ? { token: opts.token, password: pw } : { email, password: pw, name: v('name') })
      .catch(() => ({ ok: false, field: 'email', error: 'Error: no hay conexión con el servidor' }));
    btn.disabled = false; btn.textContent = label;
    if (!r.ok) return stop(r.field || (rst ? 'password' : 'email'), r.error || `Error: el servidor respondió con el código ${r.status}. Probá de nuevo en un momento`);
    onEnter(r.user, reg, r.profile);
  };
}
