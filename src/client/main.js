import { ROLES } from './catalogos.js';
import { api, esc } from './util.js';
import { AVISO_BORRADOR, AVISO_INTEGRAL, AVISO_PERSONAL, AVISO_VERSION, RUTA_AVISO, avisoHTML } from './aviso.js';
import * as pc from './pc.js';
import * as ipad from './ipad.js';

const root = document.getElementById('app');

export const state = {
  perfil: null,
  modal: null,
  toast: null,
};

const ICONO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>`;

// ------------------------------------------------------------------ avisos
let toastT;
export function toast(msg) {
  state.toast = msg;
  clearTimeout(toastT);
  pintarToast();
  toastT = setTimeout(() => {
    state.toast = null;
    pintarToast();
  }, 3600);
}
function pintarToast() {
  document.querySelector('.toast')?.remove();
  if (state.toast) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = state.toast;
    document.body.appendChild(el);
  }
}

// ------------------------------------------------------------------ inicio de sesión
function loginHTML(error) {
  return `<main class="login"><form class="card" data-form="login" novalidate>
    <div class="brand">${ICONO}Taxzero<small>Expedientes tax free</small></div>
    <div><h1>Inicia <span class="hl">sesión</span></h1><p class="muted mt-8">Usa el usuario de tu área. Cada área ve solo su módulo.</p></div>
    <div class="field"><label for="l-email">Correo</label><input type="email" id="l-email" autocomplete="username" required></div>
    <div class="field"><label for="l-clave">Contraseña</label><input type="password" id="l-clave" autocomplete="current-password" required></div>
    <p class="err" id="l-err" ${error ? '' : 'hidden'}>${esc(error || '')}</p>
    <button type="submit" class="btn primary block">Entrar</button>
    <p class="muted center small"><a href="${RUTA_AVISO}">Aviso de privacidad</a></p>
  </form></main>`;
}

function mostrarLogin(error) {
  state.perfil = null;
  document.body.classList.remove('ipad-mode');
  ipad.detener();
  root.innerHTML = loginHTML(error);
  document.getElementById('l-email')?.focus();
}

async function entrar(form) {
  const email = form.querySelector('#l-email').value.trim();
  const clave = form.querySelector('#l-clave').value;
  const err = form.querySelector('#l-err');
  const btn = form.querySelector('button[type=submit]');
  if (!email || !clave) {
    err.hidden = false;
    err.textContent = 'Escribe tu correo y contraseña.';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    const { perfil } = await api('POST', '/api/sesion', { email, clave }, { onUnauthorized: false });
    state.perfil = perfil;
    if (location.hash && perfil.rol === 'ipad') location.hash = '';
    render();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

export async function salir() {
  await api('DELETE', '/api/sesion').catch(() => undefined);
  location.hash = '';
  mostrarLogin();
}

// ------------------------------------------------------------------ aviso de privacidad
const borradorHTML = () =>
  AVISO_BORRADOR ? '<p class="notice"><b>Borrador pendiente de validación del área legal.</b></p>' : '';

export function avisoIntegralHTML() {
  return ['es', 'en'].map((l) => {
    const A = AVISO_INTEGRAL[l];
    return `<section class="aviso" lang="${l}"><h2>${esc(A.titulo)}</h2>${A.secciones.map(([t, p]) => `<h3>${esc(t)}</h3><p>${avisoHTML(p, esc)}</p>`).join('')}</section>`;
  }).join('');
}

// Página pública del aviso (no requiere sesión). El huésped la puede abrir en su teléfono.
function mostrarAvisoPublico() {
  document.body.classList.remove('ipad-mode');
  root.innerHTML = `<main class="wrap aviso-pag"><div class="card flat stack">
    <div class="brand">${ICONO}Taxzero<small>Fairmont Mayakoba</small></div>
    ${borradorHTML()}${avisoIntegralHTML()}
    <p class="muted small">Versión ${esc(AVISO_VERSION)}</p>
    <p><a href="#/">${state.perfil ? 'Volver a Taxzero' : 'Ir al inicio de sesión'}</a></p>
  </div></main>`;
}

function mostrarAvisoPersonal(error) {
  document.body.classList.remove('ipad-mode');
  root.innerHTML = `<main class="login"><form class="card aviso-card" data-form="aviso" novalidate>
    <div class="brand">${ICONO}Taxzero<small>Expedientes tax free</small></div>
    <div><h1>${esc(AVISO_PERSONAL.titulo)}</h1><p class="muted mt-8">Hola, ${esc(state.perfil.nombre)}. Antes de entrar, lee y acepta lo siguiente. Solo se pide una vez, o cuando el aviso cambie.</p></div>
    ${borradorHTML()}
    <ul class="aviso-lista">${AVISO_PERSONAL.puntos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="small"><a href="${RUTA_AVISO}" target="_blank" rel="noopener">Leer el aviso de privacidad para huéspedes</a></p>
    <label class="check-inline"><input type="checkbox" id="av-ok"> He leído el aviso y me comprometo a cumplirlo.</label>
    <p class="err" id="av-err" ${error ? '' : 'hidden'}>${esc(error || '')}</p>
    <div class="row space-between"><button type="button" class="btn" data-a="salir">Cerrar sesión</button><button type="submit" class="btn primary" id="av-btn" disabled>Aceptar y entrar</button></div>
  </form></main>`;
}

async function aceptarAviso(form) {
  const btn = form.querySelector('#av-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const { perfil } = await api('POST', '/api/aviso', { version: AVISO_VERSION });
    state.perfil = perfil;
    render();
  } catch (e) {
    mostrarAvisoPersonal(e.message);
  }
}

// ------------------------------------------------------------------ marco
function secciones(rol) {
  const s = [['/', 'Grupos'], ['/avance', 'Avance']];
  if (rol === 'admin' || rol === 'impuestos') s.push(['/bitacora', 'Bitácora']);
  if (rol === 'admin') s.push(['/usuarios', 'Usuarios']);
  return s;
}
function seccionActual() {
  const h = location.hash.replace(/^#/, '');
  return ['/avance', '/bitacora', '/usuarios'].find((x) => h.startsWith(x)) || '/';
}
export function header() {
  const p = state.perfil;
  const r = ROLES[p.rol];
  const ini = p.nombre.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  return `<header class="top"><div class="wrap top-in">
    <a class="brand" href="#/">${ICONO}Taxzero<small>Expedientes tax free</small></a>
    <nav class="roles" aria-label="Secciones">${secciones(p.rol).map(([h, t]) => `<a class="tab" href="#${h}" aria-selected="${seccionActual() === h}">${t}</a>`).join('')}</nav>
    <div class="who"><span class="avatar">${esc(ini)}</span><span>${esc(p.nombre)}<br><small>${esc(r.label)} · ${r.where} · <button class="linkbtn" data-a="miclave">Cambiar contraseña</button> · <button class="linkbtn" data-a="salir">Cerrar sesión</button></small></span></div>
  </div></header>`;
}

export function render() {
  if (location.hash === RUTA_AVISO) return mostrarAvisoPublico();
  if (!state.perfil) return mostrarLogin();
  if (state.perfil.aviso_version !== AVISO_VERSION) {
    ipad.detener();
    return mostrarAvisoPersonal();
  }
  if (state.perfil.rol === 'ipad') {
    document.body.classList.add('ipad-mode');
    return ipad.montar(root);
  }
  document.body.classList.remove('ipad-mode');
  pc.montar(root);
}

// ------------------------------------------------------------------ eventos globales
document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-form="login"]');
  if (f) {
    ev.preventDefault();
    entrar(f);
  }
  const a = ev.target.closest('[data-form="aviso"]');
  if (a) {
    ev.preventDefault();
    if (a.querySelector('#av-ok').checked) aceptarAviso(a);
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'av-ok') document.getElementById('av-btn').disabled = !ev.target.checked;
});
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a="salir"]');
  if (el) salir();
});
window.addEventListener('tz:sesion-terminada', () => {
  if (state.perfil) mostrarLogin('Tu sesión terminó. Vuelve a iniciar sesión.');
});
window.addEventListener('tz:aviso-pendiente', () => {
  if (state.perfil) {
    state.perfil.aviso_version = null;
    render();
  }
});
let enAviso = location.hash === RUTA_AVISO;
window.addEventListener('hashchange', () => {
  const aviso = location.hash === RUTA_AVISO;
  if (aviso || enAviso || !state.perfil || state.perfil.aviso_version !== AVISO_VERSION) {
    enAviso = aviso;
    return render();
  }
  if (state.perfil.rol !== 'ipad') pc.montar(root);
});

// ------------------------------------------------------------------ arranque
(async () => {
  if (location.hash === RUTA_AVISO) mostrarAvisoPublico();
  else root.innerHTML = '<div class="loading"><span class="spinner"></span>Cargando…</div>';
  try {
    const { perfil } = await api('GET', '/api/sesion', undefined, { onUnauthorized: false });
    state.perfil = perfil;
    render();
  } catch {
    if (location.hash === RUTA_AVISO) mostrarAvisoPublico();
    else mostrarLogin();
  }
})();
