import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  Db, Env, ErrorApi, Tokens, cerrarCapturasVencidas, cerrarSesion, iniciarSesion, renovarSesion,
} from './supabase';
import { libro } from './xlsx';
import { guardarArchivo, leerArchivo } from './archivos';

type Rol = 'admin' | 'grupos' | 'frontdesk' | 'ipad' | 'credito' | 'impuestos';
interface Perfil { id: string; nombre: string; rol: Rol; aviso_version?: string | null }
type Vars = { db: Db; perfil: Perfil; tokens: Tokens };

const COOKIE = 'tz_sesion';
const PC: Rol[] = ['admin', 'grupos', 'frontdesk', 'credito', 'impuestos'];
const TIPOS = ['pasaporte', 'regcard', 'pago', 'fmm', 'constancia'] as const;
const TIPOS_EVENTO = ['congreso', 'convencion', 'exposicion', 'feria'];
const DOCS_GRUPO = ['contrato', 'agenda', 'salones', 'asistentes', 'organizador', 'constancias', 'rooming'];
const DOCS_CREDITO = ['autorizacion', 'conciliacion', 'reporte_opera', 'extraordinario'];
const MAX_DOC_GRUPO = 20 * 1024 * 1024;
// Tipos de archivo aceptados para documentos del evento, con su firma de inicio.
const ARCHIVOS: Record<string, { ext: string; firma: number[] }> = {
  'application/pdf': { ext: 'pdf', firma: [0x25, 0x50, 0x44, 0x46] },
  'image/jpeg': { ext: 'jpg', firma: [0xff, 0xd8, 0xff] },
  'image/png': { ext: 'png', firma: [0x89, 0x50, 0x4e, 0x47] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', firma: [0x50, 0x4b, 0x03, 0x04] },
  'application/vnd.ms-excel': { ext: 'xls', firma: [0xd0, 0xcf, 0x11, 0xe0] },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODIGO = /^TZ-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const MAX_FOTO = 8 * 1024 * 1024;
// Versión vigente del aviso de privacidad. Debe coincidir con src/client/aviso.js.
const AVISO_VERSION = '2026-11-v1';

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
  const [perfil] = await db.rpc<Perfil[]>('mi_sesion');
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
    [perfil] = await db.rpc<Perfil[]>('mi_sesion');
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
  // Sin aceptar el aviso de privacidad vigente solo se puede consultar la sesión y aceptarlo.
  const libre = (c.req.method === 'GET' && c.req.path === '/api/sesion') || c.req.path === '/api/aviso';
  if (perfil.aviso_version !== AVISO_VERSION && !libre) {
    return c.json({ error: 'Acepta el aviso de privacidad para continuar.', code: 'AVISO_PENDIENTE' }, 428);
  }
  await next();
});

app.get('/api/sesion', (c) => c.json({ perfil: c.get('perfil') }));

app.post('/api/aviso', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (b.version !== AVISO_VERSION) throw new ErrorApi(409, 'El aviso cambió. Recarga la página para leer la versión vigente.');
  await c.get('db').rpc('aceptar_aviso', { p_version: AVISO_VERSION });
  return c.json({ perfil: { ...c.get('perfil'), aviso_version: AVISO_VERSION } });
});

// ------------------------------------------------------------------ grupos
app.get('/api/grupos', async (c) => {
  exigir(c, ...PC);
  let grupos = await c.get('db').select('resumen_grupos?select=*&order=llegada.desc,creado_en.desc');
  // Front Desk no ve el reporte de Avance: se le quitan los datos de expedientes detenidos.
  // Front Desk solo ve grupos en casa o por llegar (salida de hoy en adelante, hora de Cancún).
  if (c.get('perfil').rol === 'frontdesk') {
    const hoy = hoyLocal();
    grupos = grupos.filter((g: any) => g.salida >= hoy).map(({ detenidos: _d, ultimo_movimiento: _u, ...g }: any) => g);
  }
  return c.json({ grupos });
});

// Front Desk no puede abrir ni trabajar en grupos cuya salida oficial ya pasó.
const GRUPO_CERRADO_FD = 'Este grupo ya salió. Front Desk solo ve grupos en casa o por llegar.';
async function exigirGrupoVigenteFD(c: any, grupoId: string) {
  if (c.get('perfil').rol !== 'frontdesk') return;
  const [g] = await c.get('db').select(`grupos?id=eq.${grupoId}&select=salida`);
  if (g && g.salida < hoyLocal()) throw new ErrorApi(403, GRUPO_CERRADO_FD);
}
async function exigirExpedienteVigenteFD(c: any, expId: string) {
  if (c.get('perfil').rol !== 'frontdesk') return;
  const [e] = await c.get('db').select(`expedientes?id=eq.${expId}&select=grupo_id`);
  if (e) await exigirGrupoVigenteFD(c, e.grupo_id);
}

// Datos generales del grupo, comunes al alta y a la edición.
function datosGrupo(b: any) {
  const llegada = fecha(b.llegada);
  const salida = fecha(b.salida);
  if (salida < llegada) throw new ErrorApi(400, 'La salida no puede ser antes de la llegada.');
  const est = b.estimados === '' || b.estimados == null ? null : Number(b.estimados);
  if (est !== null && (!Number.isInteger(est) || est < 1 || est > 5000)) {
    throw new ErrorApi(400, 'Los huéspedes estimados deben ser un número entre 1 y 5000.');
  }
  return {
    p_nombre: texto(b.nombre, 200),
    p_empresa: texto(b.empresa, 200),
    p_contacto: texto(b.contacto, 200, false),
    p_codigo_opera: texto(b.codigo_opera, 60, false),
    p_llegada: llegada,
    p_salida: salida,
    p_estimados: est,
  };
}

app.post('/api/grupos', async (c) => {
  exigir(c, 'grupos', 'admin');
  const b = await c.req.json().catch(() => ({}));
  const datos = datosGrupo(b);
  // La fecha de hoy se toma en hora de Cancún, no en la del equipo de quien captura.
  if (datos.p_llegada < hoyLocal()) throw new ErrorApi(400, 'La llegada no puede ser anterior a hoy.');
  const id = await c.get('db').rpc<string>('crear_grupo', datos);
  if (b.evento && b.evento.tipo) await registrarEvento(c, id, b.evento);
  return c.json({ id }, 201);
});

// Corrección de datos del grupo. La base valida las reglas (motivo, expedientes cerrados, fechas)
// y deja cada cambio en la bitácora con el valor anterior y el nuevo.
app.post('/api/grupos/:id/datos', async (c) => {
  exigir(c, 'grupos', 'admin');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const motivo = texto(b.motivo, 500, false);
  if (motivo.length < 3) throw new ErrorApi(400, 'Escribe el motivo del cambio.');
  const cambios = await c.get('db').rpc<number>('editar_grupo', { p_grupo: id, ...datosGrupo(b), p_motivo: motivo });
  return c.json({ cambios });
});

async function registrarEvento(c: any, grupo: string, e: any) {
  if (!TIPOS_EVENTO.includes(e.tipo)) throw new ErrorApi(400, 'Elige el tipo de evento.');
  const pais = texto(e.pais_codigo, 3, false).toUpperCase();
  if (pais && !/^[A-Z]{3}$/.test(pais)) throw new ErrorApi(400, 'Elige el país del organizador de la lista.');
  await c.get('db').rpc('registrar_evento', {
    p_grupo: grupo, p_tipo: e.tipo, p_organizador: texto(e.organizador, 200),
    p_pais_codigo: pais || null, p_pais: texto(e.pais, 80, false) || null, p_id_fiscal: texto(e.id_fiscal, 60, false) || null,
  });
}

app.post('/api/grupos/:id/evento', async (c) => {
  exigir(c, 'grupos', 'admin');
  const id = uuid(c.req.param('id'));
  await registrarEvento(c, id, await c.req.json().catch(() => ({})));
  return c.json({ ok: true }, 201);
});

app.post('/api/grupos/:id/documentos', async (c) => {
  exigir(c, 'grupos', 'admin');
  const id = uuid(c.req.param('id'));
  const tipo = c.req.query('tipo') || '';
  if (!DOCS_GRUPO.includes(tipo)) throw new ErrorApi(400, 'Tipo de documento inválido.');
  const nombre = texto(c.req.query('nombre'), 200);
  const mime = (c.req.header('content-type') || '').split(';')[0].trim();
  const a = ARCHIVOS[mime];
  const esExcel = a?.ext === 'xlsx' || a?.ext === 'xls';
  if (!a || (esExcel && tipo !== 'rooming')) {
    throw new ErrorApi(415, tipo === 'rooming' ? 'Sube el rooming list en Excel, PDF o foto.' : 'Sube el documento en PDF o como foto (JPG o PNG).');
  }
  const cuerpo = await c.req.arrayBuffer();
  if (cuerpo.byteLength < 100 || cuerpo.byteLength > MAX_DOC_GRUPO) {
    throw new ErrorApi(413, 'El archivo debe pesar menos de 20 MB.');
  }
  const ini = new Uint8Array(cuerpo, 0, 4);
  if (!a.firma.every((b, i) => ini[i] === b)) throw new ErrorApi(415, 'El archivo no corresponde a su tipo. Vuelve a exportarlo.');
  const ruta = `grp/${id}/${tipo}/${crypto.randomUUID()}.${a.ext}`;
  const db = c.get('db');
  await guardarArchivo(c.env, db, ruta, cuerpo, mime, 'puede_subir_doc_grupo', 'No se pudo guardar el archivo. Intenta de nuevo.');
  const doc = await db.rpc<string>('registrar_doc_grupo', {
    p_grupo: id, p_tipo: tipo, p_ruta: ruta, p_nombre: nombre, p_mime: mime, p_bytes: cuerpo.byteLength,
  });
  return c.json({ id: doc }, 201);
});

// Documentos de Crédito del grupo: autorización, conciliación, reportes de Opera y extraordinarios.
app.post('/api/grupos/:id/documentos-credito', async (c) => {
  exigir(c, 'credito');
  const id = uuid(c.req.param('id'));
  const tipo = c.req.query('tipo') || '';
  if (!DOCS_CREDITO.includes(tipo)) throw new ErrorApi(400, 'Tipo de documento inválido.');
  const nombre = texto(c.req.query('nombre'), 200);
  const descripcion = texto(c.req.query('descripcion'), 500, false);
  if (tipo === 'extraordinario' && descripcion.length < 3) throw new ErrorApi(400, 'Describe qué es el documento extraordinario.');
  const mime = (c.req.header('content-type') || '').split(';')[0].trim();
  const a = ARCHIVOS[mime];
  const esExcel = a?.ext === 'xlsx' || a?.ext === 'xls';
  if (!a || (esExcel && tipo === 'autorizacion')) {
    throw new ErrorApi(415, tipo === 'autorizacion' ? 'Sube la autorización firmada en PDF o como foto (JPG o PNG).' : 'Sube el documento en PDF, Excel o foto (JPG o PNG).');
  }
  const cuerpo = await c.req.arrayBuffer();
  if (cuerpo.byteLength < 100 || cuerpo.byteLength > MAX_DOC_GRUPO) {
    throw new ErrorApi(413, 'El archivo debe pesar menos de 20 MB.');
  }
  const ini = new Uint8Array(cuerpo, 0, 4);
  if (!a.firma.every((b, i) => ini[i] === b)) throw new ErrorApi(415, 'El archivo no corresponde a su tipo. Vuelve a exportarlo.');
  const ruta = `cred/${id}/${tipo}/${crypto.randomUUID()}.${a.ext}`;
  const db = c.get('db');
  await guardarArchivo(c.env, db, ruta, cuerpo, mime, 'puede_subir_doc_credito', 'No se pudo guardar el archivo. Intenta de nuevo.');
  const doc = await db.rpc<string>('registrar_doc_credito', {
    p_grupo: id, p_tipo: tipo, p_descripcion: descripcion || null, p_ruta: ruta, p_nombre: nombre, p_mime: mime, p_bytes: cuerpo.byteLength,
  });
  return c.json({ id: doc }, 201);
});

app.get('/api/documentos-credito/:id/archivo', async (c) => {
  exigir(c, 'admin', 'credito', 'impuestos');
  const id = uuid(c.req.param('id'));
  const db = c.get('db');
  const [doc] = await db.select(`documentos_credito?id=eq.${id}&select=ruta,mime,nombre_archivo`);
  if (!doc) throw new ErrorApi(404, 'El documento no existe.');
  const cuerpo = await leerArchivo(c.env, db, doc.ruta);
  const enLinea = doc.mime === 'application/pdf' || doc.mime.startsWith('image/');
  return new Response(cuerpo, {
    headers: {
      'content-type': doc.mime,
      'content-disposition': `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.nombre_archivo)}`,
      'cache-control': 'private, max-age=3600',
    },
  });
});

app.post('/api/grupos/:id/folio-maestra', async (c) => {
  exigir(c, 'credito');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  await c.get('db').rpc('registrar_folio_maestra', { p_grupo: id, p_folio: texto(b.folio, 60), p_nota: texto(b.nota, 500, false) || null });
  return c.json({ ok: true }, 201);
});

app.get('/api/documentos-grupo/:id/archivo', async (c) => {
  exigir(c, 'admin', 'grupos', 'credito', 'impuestos');
  const id = uuid(c.req.param('id'));
  const db = c.get('db');
  const [doc] = await db.select(`documentos_grupo?id=eq.${id}&select=ruta,mime,nombre_archivo`);
  if (!doc) throw new ErrorApi(404, 'El documento no existe.');
  const cuerpo = await leerArchivo(c.env, db, doc.ruta);
  const enLinea = doc.mime === 'application/pdf' || doc.mime.startsWith('image/');
  const nombre = encodeURIComponent(doc.nombre_archivo);
  return new Response(cuerpo, {
    headers: {
      'content-type': doc.mime,
      'content-disposition': `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${nombre}`,
      'cache-control': 'private, max-age=3600',
    },
  });
});

app.post('/api/grupos/:id/verificacion', async (c) => {
  exigir(c, 'impuestos');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const punto = Number(b.punto);
  if (!Number.isInteger(punto) || punto < 1 || punto > 10) throw new ErrorApi(400, 'Punto de verificación inválido.');
  await c.get('db').rpc('marcar_verificacion', { p_grupo: id, p_punto: punto, p_marcado: !!b.marcado });
  return c.json({ ok: true }, 201);
});

app.post('/api/grupos/:id/riesgo', async (c) => {
  exigir(c, 'impuestos');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  if (!['bajo', 'medio', 'alto'].includes(b.nivel)) throw new ErrorApi(400, 'Elige el nivel de riesgo.');
  await c.get('db').rpc('registrar_riesgo', { p_grupo: id, p_nivel: b.nivel, p_nota: texto(b.nota, 500) });
  return c.json({ ok: true }, 201);
});

app.get('/api/grupos/:id', async (c) => {
  exigir(c, ...PC);
  const id = uuid(c.req.param('id'));
  const db = c.get('db');
  const [grupo] = await db.select(`grupos?id=eq.${id}&select=*`);
  if (!grupo) throw new ErrorApi(404, 'El grupo no existe.');
  if (c.get('perfil').rol === 'frontdesk' && grupo.salida < hoyLocal()) throw new ErrorApi(403, GRUPO_CERRADO_FD);
  const expedientes = await db.select(
    `expedientes?grupo_id=eq.${id}&select=id,folio,nombre,apellidos,nacionalidad,nacionalidad_codigo,pasaporte,pasaporte_vence,estado,recapturar,actualizado_en&order=actualizado_en.desc`,
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
  let montos: any[] = [];
  let facturas: any[] = [];
  let evento: any[] = [];
  let docs_grupo: any[] = [];
  let verificacion: any[] = [];
  let riesgos: any[] = [];
  let bitacora: any[] = [];
  let docs_credito: any[] = [];
  let folios_maestra: any[] = [];
  if (['admin', 'credito', 'impuestos'].includes(c.get('perfil').rol)) {
    [docs_credito, folios_maestra] = await Promise.all([
      db.select(`documentos_credito?grupo_id=eq.${id}&select=id,tipo,descripcion,nombre_archivo,mime,bytes,subido_por_nombre,subido_en&order=subido_en.asc`),
      db.select(`folios_maestra_grupo?grupo_id=eq.${id}&select=id,folio,nota,registrado_por_nombre,ts&order=ts.asc,id.asc`),
    ]);
  }
  if (c.get('perfil').rol !== 'frontdesk') {
    [montos, facturas, evento, docs_grupo, verificacion, riesgos, bitacora] = await Promise.all([
      db.select(`montos_grupo?grupo_id=eq.${id}&select=id,valor,nota,registrado_por_nombre,ts&order=ts.asc,id.asc`),
      db.select(`facturas_grupo?grupo_id=eq.${id}&select=id,folio,tipo,registrado_por_nombre,ts&order=ts.asc,id.asc`),
      db.select(`evento_grupo?grupo_id=eq.${id}&select=id,tipo,organizador,pais_codigo,pais,id_fiscal,registrado_por_nombre,ts&order=ts.asc,id.asc`),
      db.select(`documentos_grupo?grupo_id=eq.${id}&select=id,tipo,nombre_archivo,mime,bytes,subido_por_nombre,subido_en&order=subido_en.asc`),
      db.select(`verificacion_grupo?grupo_id=eq.${id}&select=punto,marcado,registrado_por_nombre,ts&order=ts.asc,id.asc`),
      db.select(`riesgo_grupo?grupo_id=eq.${id}&select=id,nivel,nota,registrado_por_nombre,ts&order=ts.asc,id.asc`),
      db.select(`bitacora?grupo_id=eq.${id}&expediente_id=is.null&select=ts,usuario_nombre,rol,accion,motivo&order=ts.desc,id.desc&limit=100`),
    ]);
  } else {
    evento = await db.select(`evento_grupo?grupo_id=eq.${id}&select=id,tipo,organizador,pais,ts&order=ts.asc,id.asc`);
  }
  return c.json({ grupo, expedientes, codigos, montos, facturas, evento, docs_grupo, verificacion, riesgos, bitacora, docs_credito, folios_maestra });
});

app.post('/api/grupos/:id/monto', async (c) => {
  exigir(c, 'credito');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  await c.get('db').rpc('registrar_monto', { p_grupo: id, p_valor: texto(b.valor, 40), p_nota: texto(b.nota, 500) });
  return c.json({ ok: true }, 201);
});

app.post('/api/grupos/:id/factura', async (c) => {
  exigir(c, 'impuestos');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const tipo = b.tipo === 'personal' ? 'personal' : 'evento';
  await c.get('db').rpc('registrar_factura_tipo', { p_grupo: id, p_folio: texto(b.folio, 60), p_tipo: tipo });
  return c.json({ ok: true }, 201);
});

app.post('/api/grupos/:id/huespedes', async (c) => {
  exigir(c, 'frontdesk', 'admin');
  const grupo = uuid(c.req.param('id'));
  await exigirGrupoVigenteFD(c, grupo);
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
  if (b.pasaporte_vence) await db.rpc('registrar_vencimiento', { p_expediente: id, p_fecha: fecha(b.pasaporte_vence) });
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
  await exigirGrupoVigenteFD(c, expediente.grupo_id);
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

const ACCIONES: Record<string, Rol> = {
  aprobar: 'grupos', recaptura: 'grupos', no_aplica: 'grupos',
  validar: 'credito', devolver_grupos: 'credito',
  cerrar: 'impuestos', devolver_credito: 'impuestos', reabrir: 'impuestos',
};
const ESTADOS = ['pendiente', 'incompleta', 'rev_grupos', 'val_credito', 'rev_impuestos', 'cerrado', 'dev_grupos', 'dev_credito', 'no_aplica'];

app.post('/api/expedientes/:id/accion', async (c) => {
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const accion = String(b.accion || '');
  if (!ACCIONES[accion]) throw new ErrorApi(400, 'Acción no válida.');
  exigir(c, ACCIONES[accion]);
  if (!ESTADOS.includes(b.estado)) throw new ErrorApi(400, 'Falta el estado del expediente.');
  const docs = Array.isArray(b.docs) ? b.docs.filter((d: string) => (TIPOS as readonly string[]).includes(d)) : null;
  const estado = await c.get('db').rpc<string>('revisar_expediente', {
    p_expediente: id, p_accion: accion, p_estado: b.estado,
    p_motivo: texto(b.motivo, 500, false) || null, p_docs: docs && docs.length ? docs : null,
  });
  return c.json({ estado });
});

app.post('/api/expedientes/:id/vencimiento', async (c) => {
  exigir(c, 'frontdesk', 'grupos', 'admin');
  const id = uuid(c.req.param('id'));
  await exigirExpedienteVigenteFD(c, id);
  const b = await c.req.json().catch(() => ({}));
  await c.get('db').rpc('registrar_vencimiento', { p_expediente: id, p_fecha: fecha(b.fecha) });
  return c.json({ ok: true }, 201);
});

app.post('/api/expedientes/:id/codigo', async (c) => {
  exigir(c, 'frontdesk', 'admin');
  const id = uuid(c.req.param('id'));
  await exigirExpedienteVigenteFD(c, id);
  const [codigo] = await c.get('db').rpc<any[]>('generar_codigo', { p_expediente: id });
  return c.json({ codigo });
});

app.get('/api/documentos/:id/imagen', async (c) => {
  exigir(c, ...PC);
  const id = uuid(c.req.param('id'));
  const db = c.get('db');
  const [doc] = await db.select(`documentos?id=eq.${id}&select=ruta,mime,expediente_id`);
  if (!doc) throw new ErrorApi(404, 'El documento no existe.');
  await exigirExpedienteVigenteFD(c, doc.expediente_id);
  const cuerpo = await leerArchivo(c.env, db, doc.ruta);
  return new Response(cuerpo, {
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

app.post('/api/captura/:codigo/aviso', async (c) => {
  exigir(c, 'ipad');
  const codigo = c.req.param('codigo');
  if (!CODIGO.test(codigo)) throw new ErrorApi(404, 'No encontrado.');
  const b = await c.req.json().catch(() => ({}));
  if (b.version !== AVISO_VERSION) throw new ErrorApi(409, 'El aviso cambió. Recarga la página para leer la versión vigente.');
  await c.get('db').rpc('aviso_huesped', { p_codigo: codigo, p_acepta: b.acepta === true, p_version: AVISO_VERSION });
  return c.json({ ok: true });
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
  await guardarArchivo(c.env, db, ruta, cuerpo, 'image/jpeg', 'puede_subir_documento', 'La captura ya no está activa. Pide a Front Desk un código nuevo.');
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

// ------------------------------------------------------------------ usuarios (Administración)
const ROLES: Rol[] = ['admin', 'grupos', 'frontdesk', 'ipad', 'credito', 'impuestos'];
function rolValido(v: unknown): Rol {
  if (!ROLES.includes(v as Rol)) throw new ErrorApi(400, 'Elige el área.');
  return v as Rol;
}
function clave(v: unknown): string {
  // Las contraseñas no se recortan: se usan tal como se escribieron.
  const s = typeof v === 'string' ? v : '';
  if (!s) throw new ErrorApi(400, 'Escribe la contraseña.');
  if (s.length > 72) throw new ErrorApi(400, 'La contraseña es demasiado larga (máximo 72 caracteres).');
  return s;
}

app.get('/api/usuarios', async (c) => {
  exigir(c, 'admin');
  const db = c.get('db');
  const [usuarios, bitacora] = await Promise.all([db.rpc<any[]>('listar_usuarios'), db.rpc<any[]>('bitacora_usuarios')]);
  return c.json({ usuarios, bitacora });
});

app.post('/api/usuarios', async (c) => {
  exigir(c, 'admin');
  const b = await c.req.json().catch(() => ({}));
  const id = await c.get('db').rpc<string>('crear_usuario', {
    p_email: texto(b.email, 200).toLowerCase(), p_clave: clave(b.clave), p_nombre: texto(b.nombre, 120), p_rol: rolValido(b.rol),
  });
  return c.json({ id }, 201);
});

app.post('/api/usuarios/:id/area', async (c) => {
  exigir(c, 'admin');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  await c.get('db').rpc('cambiar_area_usuario', { p_usuario: id, p_rol: rolValido(b.rol) });
  return c.json({ ok: true });
});

app.post('/api/usuarios/:id/estado', async (c) => {
  exigir(c, 'admin');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  await c.get('db').rpc('activar_usuario', { p_usuario: id, p_activo: !!b.activo, p_motivo: texto(b.motivo, 500, false) || null });
  return c.json({ ok: true });
});

app.post('/api/usuarios/:id/clave', async (c) => {
  exigir(c, 'admin');
  const id = uuid(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  await c.get('db').rpc('restablecer_clave', { p_usuario: id, p_clave: clave(b.clave) });
  return c.json({ ok: true });
});

app.post('/api/mi-clave', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  await c.get('db').rpc('cambiar_mi_clave', { p_actual: clave(b.actual), p_nueva: clave(b.nueva) });
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ reportes (etapa 5)
const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente de captura', incompleta: 'Captura incompleta', rev_grupos: 'En revisión de Grupos',
  val_credito: 'En validación de Crédito', rev_impuestos: 'En revisión de Impuestos', cerrado: 'Cerrado',
  dev_grupos: 'Devuelto a Grupos', dev_credito: 'Devuelto a Crédito', no_aplica: 'No aplica',
};
const ETIQUETA_DOC: Record<string, string> = {
  pasaporte: 'Pasaporte', regcard: 'Registration card', pago: 'Comprobante de pago', fmm: 'Forma migratoria', constancia: 'Gafete o constancia',
};
const AREAS = ['Administración', 'Grupos', 'Front Desk', 'iPad', 'Crédito', 'Impuestos'];
const ZONA = 'America/Cancun';

function horaLocal(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('es-MX', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
function hoyLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA });
}
function archivoExcel(datos: Uint8Array, nombre: string): Response {
  return new Response(datos, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Nombre sin acentos: algunos navegadores ignoran nombres con caracteres especiales.
      'content-disposition': `attachment; filename="${nombre.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '')}"`,
      'cache-control': 'no-store',
    },
  });
}
const nombreArchivo = (s: string) => s.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'grupo';

app.get('/api/grupos/:id/excel', async (c) => {
  exigir(c, 'admin', 'grupos', 'credito', 'impuestos');
  const id = uuid(c.req.param('id'));
  const db = c.get('db');
  const [grupo] = await db.select(`grupos?id=eq.${id}&select=*`);
  if (!grupo) throw new ErrorApi(404, 'El grupo no existe.');
  const [expedientes, facturas, montos, evento] = await Promise.all([
    db.select(`expedientes?grupo_id=eq.${id}&select=folio,nombre,apellidos,nacionalidad,pasaporte,pasaporte_vence,estado,recapturar,actualizado_en&order=apellidos.asc,nombre.asc`),
    db.select(`facturas_grupo?grupo_id=eq.${id}&select=folio,tipo&order=ts.asc,id.asc`),
    db.select(`montos_grupo?grupo_id=eq.${id}&select=valor&order=ts.desc,id.desc&limit=1`),
    db.select(`evento_grupo?grupo_id=eq.${id}&select=tipo,organizador,pais&order=ts.desc,id.desc&limit=1`),
  ]);
  await db.rpc('anotar_descarga', { p_grupo: id, p_que: 'lista' });
  const ultimaFactura = (t: string) => facturas.filter((f: any) => f.tipo === t).map((f: any) => f.folio).pop() || '';
  const ev = evento[0];
  const filas: (string | number | null)[][] = [
    ['Grupo', grupo.nombre],
    ['Empresa', grupo.empresa],
    ['Código de grupo en Opera', grupo.codigo_opera || ''],
    ['Llegada y salida oficiales', `${grupo.llegada} al ${grupo.salida}`],
    ['Organizador del evento', ev ? `${ev.organizador}${ev.pais ? ` (${ev.pais})` : ''}` : ''],
    ['Factura del evento', ultimaFactura('evento')],
    ['Factura de días personales', ultimaFactura('personal')],
    ['Monto de devolución registrado por Crédito', montos[0]?.valor || ''],
    ['Descargado', `${horaLocal(new Date().toISOString())} por ${c.get('perfil').nombre}`],
    [],
    ['Folio', 'Apellidos', 'Nombre', 'Nacionalidad', 'Pasaporte', 'Vence pasaporte', 'Estado', 'Por recapturar', 'Último movimiento'],
    ...expedientes.map((e: any) => [
      `EXP-${e.folio}`, e.apellidos, e.nombre, e.nacionalidad, e.pasaporte || '', e.pasaporte_vence || '',
      ETIQUETA_ESTADO[e.estado] || e.estado, (e.recapturar || []).map((d: string) => ETIQUETA_DOC[d] || d).join(', '),
      horaLocal(e.actualizado_en),
    ]),
  ];
  const datos = libro({
    nombre: 'Huéspedes', filas, negritas: [0, 10], anchos: [12, 24, 20, 18, 14, 14, 26, 24, 18],
  });
  return archivoExcel(datos, `Huéspedes ${nombreArchivo(grupo.nombre)} ${hoyLocal()}.xlsx`);
});

// Filtros de la bitácora general. Las fechas son días en hora de Cancún (UTC-5, sin horario de verano).
function filtrosBitacora(q: Record<string, string>): string {
  const f: string[] = [];
  const dia = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const desde = dia(q.desde);
  const hasta = dia(q.hasta);
  if (desde) f.push(`ts=gte.${encodeURIComponent(`${desde}T00:00:00-05:00`)}`);
  if (hasta) {
    const sig = new Date(`${hasta}T00:00:00Z`);
    sig.setUTCDate(sig.getUTCDate() + 1);
    f.push(`ts=lt.${encodeURIComponent(`${sig.toISOString().slice(0, 10)}T00:00:00-05:00`)}`);
  }
  if (q.area && AREAS.includes(q.area)) f.push(`rol=eq.${encodeURIComponent(q.area)}`);
  if (q.grupo && UUID.test(q.grupo)) f.push(`grupo_id=eq.${q.grupo}`);
  const persona = (q.persona || '').replace(/[*,()%\\]/g, ' ').trim().slice(0, 60);
  if (persona) f.push(`usuario_nombre=ilike.${encodeURIComponent(`*${persona}*`)}`);
  const texto = (q.texto || '').replace(/[*,()%\\]/g, ' ').trim().slice(0, 60);
  if (texto) f.push(`accion=ilike.${encodeURIComponent(`*${texto}*`)}`);
  return f.length ? `&${f.join('&')}` : '';
}
const SELECT_BITACORA = 'select=id,ts,usuario_nombre,rol,accion,motivo,grupo_id,expediente_id,grupos(folio,nombre),expedientes(folio,nombre,apellidos)';
const POR_PAGINA = 100;

app.get('/api/bitacora', async (c) => {
  exigir(c, 'admin', 'impuestos');
  const q = c.req.query();
  const pagina = Math.max(0, Math.min(1000, Number.parseInt(q.pagina || '0', 10) || 0));
  const filas = await c.get('db').select(
    `bitacora?${SELECT_BITACORA}${filtrosBitacora(q)}&order=ts.desc,id.desc&limit=${POR_PAGINA + 1}&offset=${pagina * POR_PAGINA}`,
  );
  return c.json({ filas: filas.slice(0, POR_PAGINA), hay_mas: filas.length > POR_PAGINA, pagina });
});

const MAX_EXCEL_BITACORA = 10000;
app.get('/api/bitacora/excel', async (c) => {
  exigir(c, 'admin', 'impuestos');
  const q = c.req.query();
  const db = c.get('db');
  const filtros = filtrosBitacora(q);
  let filas: any[] = [];
  // Supabase entrega máximo 1,000 filas por consulta: se piden por bloques.
  for (let off = 0; off < MAX_EXCEL_BITACORA; off += 1000) {
    const lote = await db.select(`bitacora?${SELECT_BITACORA}${filtros}&order=ts.desc,id.desc&limit=1000&offset=${off}`);
    filas = filas.concat(lote);
    if (lote.length < 1000) break;
  }
  await db.rpc('anotar_descarga', { p_grupo: null, p_que: 'bitacora' });
  const aplicados = [
    q.desde && `desde ${q.desde}`, q.hasta && `hasta ${q.hasta}`, q.area && `área ${q.area}`,
    q.persona && `persona "${q.persona}"`, q.texto && `acción con "${q.texto}"`,
    q.grupo && filas[0]?.grupos && `grupo ${filas[0].grupos.nombre}`,
  ].filter(Boolean).join(', ');
  const datos = libro({
    nombre: 'Bitácora',
    negritas: [0, 3],
    anchos: [17, 24, 16, 52, 34, 30, 28],
    filas: [
      ['Bitácora general de Taxzero'],
      [`Descargada ${horaLocal(new Date().toISOString())} por ${c.get('perfil').nombre}. Filtros: ${aplicados || 'ninguno'}.${filas.length >= MAX_EXCEL_BITACORA ? ` Solo los ${MAX_EXCEL_BITACORA} movimientos más recientes.` : ''}`],
      [],
      ['Fecha y hora', 'Persona', 'Área', 'Acción', 'Motivo', 'Grupo', 'Expediente'],
      ...filas.map((b: any) => [
        horaLocal(b.ts), b.usuario_nombre, b.rol, b.accion, b.motivo || '',
        b.grupos ? `GRP-${b.grupos.folio} ${b.grupos.nombre}` : '',
        b.expedientes ? `EXP-${b.expedientes.folio} ${b.expedientes.apellidos}, ${b.expedientes.nombre}` : '',
      ]),
    ],
  });
  return archivoExcel(datos, `Bitácora Taxzero ${hoyLocal()}.xlsx`);
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
