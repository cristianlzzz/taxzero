// Cliente mínimo de Supabase (Auth, base de datos y Storage) usando el token del
// usuario. Así los permisos los aplica la base de datos, no solo el servidor.

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ASSETS: Fetcher;
  DOCS: R2Bucket;
}

export class ErrorApi extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // segundos epoch
}

async function leerError(res: Response): Promise<ErrorApi> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  const msg: string = body?.message || body?.msg || body?.error_description || body?.error || `Error ${res.status}`;
  // Errores lanzados por nuestras funciones (P0001/P0002/42501) traen el mensaje para el usuario.
  if (body?.code === '42501') return new ErrorApi(403, msg, body.code);
  if (body?.code === 'P0001' || body?.code === 'P0002') return new ErrorApi(409, msg, body.code);
  if (body?.code === '23514' || body?.code === '22007' || body?.code === '22P02') {
    return new ErrorApi(400, 'Revisa los datos capturados.', body.code);
  }
  return new ErrorApi(res.status >= 500 ? 502 : res.status, msg, body?.code);
}

export async function iniciarSesion(env: Env, email: string, clave: string): Promise<Tokens> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: clave }),
  });
  if (res.status === 400) throw new ErrorApi(401, 'Correo o contraseña incorrectos.');
  if (!res.ok) throw await leerError(res);
  return res.json();
}

export async function renovarSesion(env: Env, refresh: string): Promise<Tokens | null> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function cerrarSesion(env: Env, access: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${access}` },
  }).catch(() => undefined);
}

export class Db {
  constructor(private env: Env, private token: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.env.SUPABASE_ANON_KEY, authorization: `Bearer ${this.token}`, ...extra };
  }

  async rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(args),
    });
    if (!res.ok) throw await leerError(res);
    const txt = await res.text();
    return (txt ? JSON.parse(txt) : null) as T;
  }

  async select<T = any>(pathAndQuery: string): Promise<T[]> {
    const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: this.headers() });
    if (!res.ok) throw await leerError(res);
    return res.json();
  }

  async descargar(bucket: string, ruta: string): Promise<Response> {
    const res = await fetch(`${this.env.SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${ruta}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new ErrorApi(res.status === 400 ? 404 : res.status, 'No se pudo cargar el documento.');
    return res;
  }
}

export async function cerrarCapturasVencidas(env: Env): Promise<number> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/cerrar_capturas_vencidas`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw await leerError(res);
  return res.json();
}
