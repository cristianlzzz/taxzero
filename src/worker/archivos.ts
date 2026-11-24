// Documentos en Cloudflare R2 (bucket privado, con candado contra borrado).
// El Worker es el único que escribe y lee: antes de guardar pregunta a la base si el
// usuario puede subir a esa carpeta, y solo entrega un archivo si la base le dejó ver
// su registro. Los archivos de prueba anteriores siguen en Supabase Storage y se leen
// de ahí si no están en R2.
import { Db, Env, ErrorApi } from './supabase';

type Permiso = 'puede_subir_documento' | 'puede_subir_doc_grupo' | 'puede_subir_doc_credito';

export async function guardarArchivo(
  env: Env, db: Db, ruta: string, cuerpo: ArrayBuffer, tipo: string, permiso: Permiso, rechazo: string,
): Promise<void> {
  const ok = await db.rpc<boolean>(permiso, { p_ruta: ruta });
  if (ok !== true) throw new ErrorApi(403, rechazo);
  // Las rutas llevan un identificador único: un archivo nunca reemplaza a otro.
  const previo = await env.DOCS.head(ruta);
  if (previo) throw new ErrorApi(409, 'Ese archivo ya existe. Intenta de nuevo.');
  await env.DOCS.put(ruta, cuerpo, { httpMetadata: { contentType: tipo } });
}

export async function leerArchivo(env: Env, db: Db, ruta: string): Promise<ReadableStream> {
  const obj = await env.DOCS.get(ruta);
  if (obj) return obj.body;
  const res = await db.descargar('documentos', ruta);
  if (!res.body) throw new ErrorApi(404, 'No se pudo cargar el documento.');
  return res.body;
}
