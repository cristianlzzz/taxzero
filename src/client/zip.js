// Escritor de archivos .zip por partes, sin compresión (método "store"): las fotos y los PDF
// ya vienen comprimidos, así que comprimir de nuevo solo gastaría tiempo. Cada archivo se
// escribe en cuanto llega, sin juntar todo en memoria. Si el .zip pasa de 4 GB o de 65,535
// archivos usa el formato ZIP64, que abren Windows, macOS y 7-Zip.
import { crc32 } from '../worker/xlsx.ts';

const enc = new TextEncoder();
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

// Fecha y hora en formato de MS-DOS, que es como el .zip guarda la fecha de cada archivo.
export function fechaDos(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class EscritorZip {
  // escribir(Uint8Array) puede ser asíncrono; se espera antes de seguir.
  // limite32 solo se cambia en las pruebas, para probar el formato ZIP64 sin escribir 4 GB.
  constructor(escribir, { limite32 = MAX32 } = {}) {
    this.escribir = escribir;
    this.limite32 = limite32;
    this.pos = 0;
    this.central = [];
    this.nombres = new Set();
  }

  async _salida(b) {
    await this.escribir(b);
    this.pos += b.length;
  }

  // Nombre único dentro del .zip: si ya existe, agrega " (2)", " (3)"...
  unico(ruta) {
    let r = ruta;
    const i = ruta.lastIndexOf('.');
    const base = i > ruta.lastIndexOf('/') ? ruta.slice(0, i) : ruta;
    const ext = i > ruta.lastIndexOf('/') ? ruta.slice(i) : '';
    for (let n = 2; this.nombres.has(r.toLowerCase()); n++) r = `${base} (${n})${ext}`;
    this.nombres.add(r.toLowerCase());
    return r;
  }

  // Devuelve el nombre con el que quedó (puede llevar " (2)" si se repetía).
  async agregar(ruta, datos, fecha = new Date()) {
    const final = this.unico(ruta);
    const nombre = enc.encode(final);
    const crc = crc32(datos);
    const { hora, dia } = fechaDos(fecha);
    const offset = this.pos;
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true);
    loc.setUint16(4, 20, true);
    loc.setUint16(6, 0x0800, true); // nombres en UTF-8
    loc.setUint16(8, 0, true); // sin compresión
    loc.setUint16(10, hora, true);
    loc.setUint16(12, dia, true);
    loc.setUint32(14, crc, true);
    loc.setUint32(18, datos.length, true);
    loc.setUint32(22, datos.length, true);
    loc.setUint16(26, nombre.length, true);
    await this._salida(new Uint8Array(loc.buffer));
    await this._salida(nombre);
    await this._salida(datos);
    this.central.push({ nombre, crc, hora, dia, tam: datos.length, offset });
    return final;
  }

  async terminar() {
    const inicio = this.pos;
    for (const e of this.central) {
      const z64 = e.offset >= this.limite32;
      const extra = z64 ? 12 : 0;
      const cen = new DataView(new ArrayBuffer(46 + e.nombre.length + extra));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 45, true);
      cen.setUint16(6, z64 ? 45 : 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(12, e.hora, true);
      cen.setUint16(14, e.dia, true);
      cen.setUint32(16, e.crc, true);
      cen.setUint32(20, e.tam, true);
      cen.setUint32(24, e.tam, true);
      cen.setUint16(28, e.nombre.length, true);
      cen.setUint16(30, extra, true);
      cen.setUint32(42, z64 ? MAX32 : e.offset, true);
      new Uint8Array(cen.buffer).set(e.nombre, 46);
      if (z64) {
        const o = 46 + e.nombre.length;
        cen.setUint16(o, 0x0001, true);
        cen.setUint16(o + 2, 8, true);
        cen.setBigUint64(o + 4, BigInt(e.offset), true);
      }
      await this._salida(new Uint8Array(cen.buffer));
    }
    const tamCentral = this.pos - inicio;
    const n = this.central.length;
    const z64 = n >= MAX16 || inicio >= this.limite32 || tamCentral >= this.limite32;
    if (z64) {
      const fin64 = this.pos;
      const r = new DataView(new ArrayBuffer(56 + 20));
      r.setUint32(0, 0x06064b50, true);
      r.setBigUint64(4, 44n, true);
      r.setUint16(12, 45, true);
      r.setUint16(14, 45, true);
      r.setBigUint64(24, BigInt(n), true);
      r.setBigUint64(32, BigInt(n), true);
      r.setBigUint64(40, BigInt(tamCentral), true);
      r.setBigUint64(48, BigInt(inicio), true);
      r.setUint32(56, 0x07064b50, true);
      r.setBigUint64(64, BigInt(fin64), true);
      r.setUint32(72, 1, true);
      await this._salida(new Uint8Array(r.buffer));
    }
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, z64 ? MAX16 : n, true);
    fin.setUint16(10, z64 ? MAX16 : n, true);
    fin.setUint32(12, z64 ? MAX32 : tamCentral, true);
    fin.setUint32(16, z64 ? MAX32 : inicio, true);
    await this._salida(new Uint8Array(fin.buffer));
    return { archivos: n, bytes: this.pos };
  }
}

// Nombre seguro para carpetas y archivos dentro del .zip (Windows y Mac): sin acentos
// ni caracteres prohibidos, sin puntos ni espacios al final.
export function nombreSeguro(s, max = 80) {
  const limpio = String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return limpio || 'sin nombre';
}
