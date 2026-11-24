// Lee la primera hoja de un archivo de Excel (.xlsx) sin librerías externas.
// Regresa una tabla: lista de renglones, cada uno con sus celdas (texto o número).

async function inflar(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// Índice del ZIP: nombre de archivo → contenido (se descomprime al pedirlo).
function indiceZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un Excel válido (.xlsx).');
  const total = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const archivos = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < total; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const tam = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true);
    const le = dv.getUint16(p + 30, true);
    const lc = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nombre = dec.decode(buf.subarray(p + 46, p + 46 + ln));
    archivos.set(nombre, { metodo, tam, local });
    p += 46 + ln + le + lc;
  }
  return async (nombre) => {
    const a = archivos.get(nombre);
    if (!a) return null;
    const ini = a.local + 30 + dv.getUint16(a.local + 26, true) + dv.getUint16(a.local + 28, true);
    const datos = buf.subarray(ini, ini + a.tam);
    const crudo = a.metodo === 0 ? datos : await inflar(datos);
    return new TextDecoder().decode(crudo);
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const desescapar = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
const textos = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1])).join('');

const columna = (ref) => {
  const letras = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function leerXlsx(arrayBuffer) {
  const leer = indiceZip(new Uint8Array(arrayBuffer));
  const wb = await leer('xl/workbook.xml');
  if (!wb) throw new Error('El archivo no es un Excel válido (.xlsx).');
  const rid = (wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || wb.match(/<sheet\b[^>]*\bid="([^"]+)"/) || [])[1];
  const rels = (await leer('xl/_rels/workbook.xml.rels')) || '';
  let destino = 'worksheets/sheet1.xml';
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (m[0].includes(`Id="${rid}"`)) destino = (m[0].match(/Target="([^"]+)"/) || [])[1] || destino;
  }
  const ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`;
  const hoja = await leer(ruta);
  if (!hoja) throw new Error('No encontramos la hoja de cálculo dentro del archivo.');
  const ss = (await leer('xl/sharedStrings.xml')) || '';
  const compartidos = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]));
  const filas = [];
  for (const r of hoja.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const num = +((r[1].match(/\br="(\d+)"/) || [])[1] || filas.length + 1) - 1;
    const celdas = [];
    for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const cuerpo = c[2] || '';
      const v = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = compartidos[+v] ?? '';
      else if (t === 'inlineStr') val = textos(cuerpo);
      else if (t === 'str' || t === 'e') val = v != null ? desescapar(v) : '';
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v != null) val = Number(v);
      celdas[ref ? columna(ref) : celdas.length] = val;
    }
    filas[num] = Array.from(celdas, (x) => x ?? '');
  }
  return Array.from(filas, (x) => x || []);
}
