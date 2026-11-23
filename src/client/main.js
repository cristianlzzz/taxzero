import { ROLES } from './catalogos.js';
import { api, esc } from './util.js';
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
  if (!state.perfil) return mostrarLogin();
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
});
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a="salir"]');
  if (el) salir();
});
window.addEventListener('tz:sesion-terminada', () => {
  if (state.perfil) mostrarLogin('Tu sesión terminó. Vuelve a iniciar sesión.');
});
window.addEventListener('hashchange', () => {
  if (state.perfil && state.perfil.rol !== 'ipad') pc.montar(root);
});

// ------------------------------------------------------------------ arranque
(async () => {
  root.innerHTML = '<div class="loading"><span class="spinner"></span>Cargando…</div>';
  try {
    const { perfil } = await api('GET', '/api/sesion', undefined, { onUnauthorized: false });
    state.perfil = perfil;
    render();
  } catch {
    mostrarLogin();
  }
})();
