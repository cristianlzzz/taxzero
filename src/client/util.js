const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ZONA = 'America/Cancun';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Fecha y hora en la zona del hotel (Cancún), sin importar la zona del equipo.
export function fmt(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-MX', {
      timeZone: ZONA, day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${+p.day} ${MES[+p.month - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

export function dateTxt(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${+d} ${MES[+m - 1]} ${y}`;
}

export const mmss = (ms) => {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const folioExp = (n) => `EXP-${n}`;
export const folioGrupo = (n) => `GRP-${n}`;

export class ErrorApi extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(method, url, body, opts = {}) {
  const headers = { 'x-taxzero': '1' };
  let payload;
  if (body instanceof Blob) {
    payload = body;
    headers['content-type'] = body.type;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ErrorApi(0, 'Sin conexión con el servidor. Revisa la red e intenta de nuevo.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  if (!res.ok) {
    const err = new ErrorApi(res.status, data?.error || `Error ${res.status}`, data?.code);
    if (res.status === 401 && opts.onUnauthorized !== false) window.dispatchEvent(new CustomEvent('tz:sesion-terminada'));
    throw err;
  }
  return data;
}
