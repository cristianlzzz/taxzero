import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  Db, Env, ErrorApi, Tokens, cerrarCapturasVencidas, cerrarSesion, iniciarSesion, renovarSesion,
} from './supabase';

type Rol = 'admin' | 'grupos' | 'frontdesk' | 'ipad' | 'credito' | 'impuestos';
interface Perfil { id: string; nombre: string; rol: Rol }
type Vars = { db: Db; perfil: Perfil; tokens: Tokens };

const COOKIE = 'tz_sesion';
const PC: Rol[] = ['admin', 'grupos', 'frontdesk', 'credito', 'impuestos'];
const TIPOS = ['pasaporte', 'regcard', 'pago', 'fmm'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODIGO = /^TZ-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const MAX_FOTO = 8 * 1024 * 1024;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ------------------------------------------------------------------ utilidades
function codificar(t: Tokens): string {
  return btoa(JSON.stringify({ a: t.access_token, r: t.refresh_token, e: t.expires_at }));
}
function decodificar(v: string | undefined): Tokens | null {
  if (!v) return null;
  try {
    const o = JSON.parse(atob(v));
    if (typeof o.a !== 'string' || typeof o.r !== 'string') return null;
    return { access_token: o.a, refresh_token: o.r, expires_at: Number(o.e) || 0 };
  } catch {
    return null;
  }
}
function guardarCookie(c: any, t: Tokens) {
  const segura = new URL(c.req.url).protocol === 'https:';
  setCookie(c, COOKIE, codificar(t), {
    httpOnly: true, secure: segura, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30,
  });
}
function uuid(v: string): string {
  if (!UUID.test(v)) throw new ErrorApi(404, 'No encontrado.');
  return v;
}
function texto(v: unknown, max: number, requerido = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (requerido && !s) throw new ErrorApi(400, 'Faltan datos obligatorios.');
  if (s.length > max) throw new ErrorApi(400, 'Uno de los datos es demasiado largo.');
  return s;
}
function fecha(v: unknown): string {
  const s = texto(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ErrorApi(400, 'Fecha inválida.');
  return s;
}
function exigir(c: any, ...roles: Rol[]) {
  const p: Perfil = c.get('perfil');
  if (!roles.includes(p.rol)) throw new ErrorApi(403, 'Tu área no tiene acceso a esta sección.');
}

// ------------------------------------------------------------------ seguridad básica
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; " +
      "style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
});

app.onError((err, c) => {
  if (err instanceof ErrorApi) return c.json({ error: err.message, code: err.code }, err.status as any);
  console.error(err);
  return c.json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' }, 500);
});

// Las peticiones que cambian algo deben venir de nuestra propia página.
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('x-taxzero') !== '1') {
    return c.json({ error: 'Petición no permitida.' }, 403);
  }
  await next();
});

// ------------------------------------------------------------------ sesión
app.post('/api/sesion', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const email = texto(b.email, 200).toLowerCase();
  const clave = texto(b.clave, 200);
  const t = await iniciarSesion(c.env, email, clave);
  const db = new Db(c.env, t.access_token);
  const [perfil] = await db.rpc<Perfil[]>('mi_perfil');
  if (!perfil) {
    await cerrarSesion(c.env, t.access_token);
    throw new ErrorApi(403, 'Tu usuario no tiene un área asignada en Taxzero. Pide acceso a TI.');
  }
  guardarCookie(c, t);
  return c.json({ perfil });
});

app.delete('/api/sesion', async (c) => {
  const t = decodificar(getCookie(c, COOKIE));
  if (t) await cerrarSesion(c.env, t.access_token);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// Todo lo demás requiere sesión. Renueva el token si está por vencer.
app.use('/api/*', async (c, next) => {
  let t = decodificar(getCookie(c, COOKIE));
  if (!t) return c.json({ error: 'Inicia sesión para continuar.' }, 401);
  if (t.expires_at - 120 < Date.now() / 1000) {
    const nuevo = await renovarSesion(c.env, t.refresh_token);
    if (!nuevo) {
      deleteCookie(c, COOKIE, { path: '/' });
      return c.json({ error: 'Tu sesión terminó. Vuelve a iniciar sesión.' }, 401);
    }
    t = nuevo;
    guardarCookie(c, t);
  }
  const db = new Db(c.env, t.access_token);
  let perfil: Perfil | undefined;
  try {
    [perfil] = await db.rpc<Perfil[]>('mi_perfil');
  } catch (e) {
    if (e instanceof ErrorApi && e.status === 401) {
      deleteCookie(c, COOKIE, { path: '/' });
      return c.json({ error: 'Tu sesión terminó. Vuelve a iniciar sesión.' }, 401);
    }
    throw e;
  }
  if (!perfil) {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ error: 'Tu usuario ya no tiene acceso a Taxzero.' }, 401);
  }
  c.set('db', db);
  c.set('perfil', perfil);
  c.set('tokens', t);
  await next();
});

app.get('/api/sesion', (c) => c.json({ perfil: c.get('perfil') }));

// ------------------------------------------------------------------ grupos
app.get('/api/grupos', async (c) => {
  exigir(c, ...PC);
  const grupos = await c.get('db').select('resumen_grupos?select=*&order=llegada.desc,creado_en.desc');
  return c.json({ grupos });
});

app.post('/api/grupos', async (c) => {
  exigir(c, 'grupos', 'admin');
  const b = await c.req.json().catch(() => ({}));
  const llegada = fecha(b.llegada);
  const salida = fecha(b.salida);
  if (salida < llegada) throw new ErrorApi(400, 'La salida no puede ser antes de la llegada.');
  const est = b.estimados === '' || b.estimados == null ? null : Number(b.estimados);
  if (est !== null && (!Number.isInteger(est) || est < 1 || est > 5000)) {
    throw new ErrorApi(400, 'Los huéspedes estimados deben ser un número entre 1 y 5000.');
  }
  const id = await c.get('db').rpc<string>('crear_grupo', {
    p_nombre: texto(b.nombre, 200),
    p_empresa: texto(b.empresa, 200),
    p_contacto: texto(b.contacto, 200, false),
    p_codigo_opera: texto(b.codigo_opera, 60, false),
    p_llegada: llegada,
    p_salida: salida,
    p_estimados: est,
  });
  return c.json({ id }, 201);
});

app.get('/api/grupos/:id', async (c) => {
  exigir(c, ...PC);
  const id = uuid(c.req.param('id'));
  const db = c.get('db');
  const [grupo] = await db.select(`grupos?id=eq.${id}&select=*`);
  if (!grupo) throw new ErrorApi(404, 'El grupo no existe.');
  const expedientes = await db.select(
    `expedientes?grupo_id=eq.${id}&select=id,folio,nombre,apellidos,nacionalidad,nacionalidad_codigo,pasaporte,estado,recapturar,actualizado_en&order=actualizado_en.desc`,
  );
  let codigos: any[] = [];
  if (c.get('perfil').rol === 'frontdesk' || c.get('perfil').rol === 'admin') {
    const ahora = new Date().toISOString();
    const ids = expedientes.filter((e: any) => ['pendiente', 'incompleta'].includes(e.estado)).map((e: any) => e.id);
    if (ids.length) {
      // Se consulta en bloques para no armar URLs enormes en grupos de 500 huéspedes.
      for (let i = 0; i < ids.length; i += 150) {
        const lote = ids.slice(i, i + 150).join(',');
        codigos = codigos.concat(await db.select(
          `codigos_captura?expediente_id=in.(${lote})&usado_en=is.null&vence_en=gt.${encodeURIComponent(ahora)}&select=codigo,expediente_id,vence_en`,
        ));
      }
    }
  }
  return c.json({ grupo, expedientes, codigos });
});

app.post('/api/grupos/:id/huespedes', async (c) => {
  exigir(c, 'frontdesk', 'admin');
  const grupo = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const nac = texto(b.nacionalidad_codigo, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(nac)) throw new ErrorApi(400, 'Elige la nacionalidad de la lista.');
  const db = c.get('db');
  const id = await db.rpc<string>('alta_huesped', {
    p_grupo: grupo,
    p_nombre: texto(b.nombre, 120),
    p_apellidos: texto(b.apellidos, 120),
    p_nac_codigo: nac,
    p_nac_nombre: texto(b.nacionalidad, 80),
    p_pasaporte: texto(b.pasaporte, 30, false),
  });
  let codigo = null;
  if (b.generar_qr) {
    [codigo] = await db.rpc<any[]>('generar_codigo', { p_expediente: id });
  }
  return c.json({ id, codigo }, 201);
});

// ------------------------------------------------------------------ expedientes
app.get('/api/expedientes/:id', async (c) => {
  exigir(c, ...PC);
  const id = uuid(c.req.param('id'));
  const db = c.get('db');
  const [expediente] = await db.select(`expedientes?id=eq.${id}&select=*`);
  if (!expediente) throw new ErrorApi(404, 'El expediente no existe.');
  const [grupo, documentos, bitacora] = await Promise.all([
    db.select(`grupos?id=eq.${expediente.grupo_id}&select=id,folio,nombre,codigo_opera,llegada,salida`).then((r) => r[0]),
    db.select(`documentos?expediente_id=eq.${id}&select=id,tipo,version,fmm_tipo,bytes,ancho,alto,nitidez,capturado_en,capturado_por_nombre&order=tipo,version`),
    db.select(`bitacora?expediente_id=eq.${id}&select=ts,usuario_nombre,rol,accion,motivo&order=ts.desc,id.desc`),
  ]);
  let codigo = null;
  const rol = c.get('perfil').rol;
  if ((rol === 'frontdesk' || rol === 'admin') && ['pendiente', 'incompleta'].includes(expediente.estado)) {
    const ahora = encodeURIComponent(new Date().toISOString());
    [codigo] = await db.select(
      `codigos_captura?expediente_id=eq.${id}&usado_en=is.null&vence_en=gt.${ahora}&select=codigo,vence_en&order=creado_en.desc&limit=1`,
    );
  }
  return c.json({ expediente, grupo, bitacora, codigo, documentos });
});

app.post('/api/expedientes/:id/codigo', async (c) => {
  exigir(c, 'frontdesk', 'admin');
  const id = uuid(c.req.param('id'));
  const [codigo] = await c.get('db').rpc<any[]>('generar_codigo', { p_expediente: id });
  return c.json({ codigo });
});

app.get('/api/documentos/:id/imagen', async (c) => {
  exigir(c, ...PC);
  const id = uuid(c.req.param('id'));
  const db = c.get('db');
  const [doc] = await db.select(`documentos?id=eq.${id}&select=ruta,mime`);
  if (!doc) throw new ErrorApi(404, 'El documento no existe.');
  const res = await db.descargar('documentos', doc.ruta);
  return new Response(res.body, {
    headers: {
      'content-type': doc.mime || 'image/jpeg',
      // Datos personales: no se guardan en cachés compartidas.
      'cache-control': 'private, max-age=3600',
    },
  });
});

// ------------------------------------------------------------------ estación de captura (iPad)
app.post('/api/captura/iniciar', async (c) => {
  exigir(c, 'ipad');
  const b = await c.req.json().catch(() => ({}));
  const codigo = texto(b.codigo, 20).toUpperCase().replace(/\s/g, '');
  if (!CODIGO.test(codigo)) throw new ErrorApi(409, 'CODIGO_NO_EXISTE', 'P0001');
  const [captura] = await c.get('db').rpc<any[]>('iniciar_captura', { p_codigo: codigo });
  return c.json({ captura: { ...captura, codigo } });
});

app.post('/api/captura/:codigo/foto', async (c) => {
  exigir(c, 'ipad');
  const codigo = c.req.param('codigo');
  if (!CODIGO.test(codigo)) throw new ErrorApi(404, 'No encontrado.');
  const q = c.req.query();
  const exp = uuid(q.exp || '');
  const tipo = q.tipo as (typeof TIPOS)[number];
  if (!TIPOS.includes(tipo)) throw new ErrorApi(400, 'Tipo de documento inválido.');
  const fmm = q.fmm && ['fmm', 'sello', 'qr'].includes(q.fmm) ? q.fmm : null;
  if ((c.req.header('content-type') || '') !== 'image/jpeg') throw new ErrorApi(415, 'La foto debe ser JPEG.');
  const cuerpo = await c.req.arrayBuffer();
  if (cuerpo.byteLength < 1000 || cuerpo.byteLength > MAX_FOTO) {
    throw new ErrorApi(413, 'La foto no tiene un tamaño válido. Vuelve a tomarla.');
  }
  const ini = new Uint8Array(cuerpo, 0, 3);
  if (ini[0] !== 0xff || ini[1] !== 0xd8 || ini[2] !== 0xff) throw new ErrorApi(415, 'La foto debe ser JPEG.');
  const n = (v: string | undefined) => (v && /^\d{1,6}(\.\d+)?$/.test(v) ? Number(v) : null);
  const ruta = `exp/${exp}/${tipo}/${crypto.randomUUID()}.jpg`;
  const db = c.get('db');
  await db.subir('documentos', ruta, cuerpo, 'image/jpeg');
  const version = await db.rpc<number>('registrar_documento', {
    p_codigo: codigo, p_tipo: tipo, p_ruta: ruta, p_fmm_tipo: tipo === 'fmm' ? fmm || 'fmm' : null,
    p_bytes: cuerpo.byteLength, p_ancho: n(q.ancho), p_alto: n(q.alto), p_nitidez: n(q.nitidez),
  });
  return c.json({ version }, 201);
});

app.post('/api/captura/:codigo/finalizar', async (c) => {
  exigir(c, 'ipad');
  const codigo = c.req.param('codigo');
  if (!CODIGO.test(codigo)) throw new ErrorApi(404, 'No encontrado.');
  const [r] = await c.get('db').rpc<any[]>('finalizar_captura', { p_codigo: codigo });
  return c.json(r);
});

app.all('/api/*', (c) => c.json({ error: 'No encontrado.' }, 404));

// ------------------------------------------------------------------ página
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
});

export default {
  fetch: app.fetch,
  // Cada 5 minutos: cierra capturas cuyo código venció sin que el iPad enviara.
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cerrarCapturasVencidas(env).then((n) => { if (n) console.log(`capturas vencidas cerradas: ${n}`); }));
  },
} satisfies ExportedHandler<Env>;
