// Escritor de .zip del expediente completo del grupo y plan de carpetas.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EscritorZip, nombreSeguro } from '../src/client/zip.js';
import { crc32 } from '../src/worker/xlsx.ts';

async function armar(archivos, opts) {
  const partes = [];
  const z = new EscritorZip(async (b) => { partes.push(b); }, opts);
  const nombres = [];
  for (const [n, d] of archivos) nombres.push(await z.agregar(n, d, new Date(2026, 10, 24, 15, 30, 10)));
  await z.terminar();
  return { buf: Buffer.concat(partes), nombres };
}

// Lee el .zip con Python (zipfile valida CRC, tamaños y ZIP64), como lo haría cualquier programa.
function leerConPython(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'tzzip-'));
  const f = join(dir, 'a.zip');
  writeFileSync(f, buf);
  const out = execFileSync('python3', ['-I', '-c', `
import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps([[i.filename, i.file_size, i.date_time[:5]] for i in z.infolist()]))
`, f]);
  return JSON.parse(out.toString());
}

const datos = (n, v) => new Uint8Array(n).fill(v);

describe('zip del expediente', () => {
  it('crc32 por partes da lo mismo que de corrido', () => {
    const a = new TextEncoder().encode('123456789');
    expect(crc32(a)).toBe(0xcbf43926);
    expect(crc32(a.subarray(8), crc32(a.subarray(0, 8)))).toBe(crc32(a));
  });

  it('arma un .zip válido con carpetas, acentos quitados y nombres repetidos', async () => {
    const { buf, nombres } = await armar([
      ['G/3 Huespedes/EXP-1 Ramirez, Jessica/1 Pasaporte.jpg', datos(5000, 1)],
      ['G/3 Huespedes/EXP-1 Ramirez, Jessica/1 Pasaporte.jpg', datos(10, 2)],
      ['G/1 Documentos del evento/01 Contrato.pdf', datos(300, 3)],
    ]);
    expect(nombres[1]).toBe('G/3 Huespedes/EXP-1 Ramirez, Jessica/1 Pasaporte (2).jpg');
    const info = leerConPython(buf);
    expect(info.map((i) => i[0])).toEqual(nombres);
    expect(info.map((i) => i[1])).toEqual([5000, 10, 300]);
    expect(info[0][2]).toEqual([2026, 11, 24, 15, 30]);
  });

  it('usa ZIP64 cuando el archivo pasa del límite', async () => {
    const archivos = Array.from({ length: 12 }, (_, i) => [`G/f${i}.bin`, datos(100, i)]);
    const { buf } = await armar(archivos, { limite32: 500 });
    expect(buf.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
    const info = leerConPython(buf);
    expect(info.length).toBe(12);
    expect(info.every((i) => i[1] === 100)).toBe(true);
  });

  it('limpia nombres para Windows y Mac', () => {
    expect(nombreSeguro('Ramírez, José / "Pepe"?')).toBe('Ramirez, Jose Pepe');
    expect(nombreSeguro('archivo.  ')).toBe('archivo');
    expect(nombreSeguro('')).toBe('sin nombre');
  });
});

describe('carpetas del expediente completo', async () => {
  const { planear, indiceExcel } = await import('../src/client/paquete.js');
  const p = {
    grupo: { id: 'g', folio: 7, nombre: 'Congreso', empresa: 'ACME', codigo_opera: 'PRUEBA-0001', llegada: '2027-03-10', salida: '2027-03-14' },
    expedientes: [{ id: 'e1', folio: 12, nombre: 'Emily', apellidos: 'Carter', nacionalidad: 'Estados Unidos', estado: 'cerrado' }],
    documentos: [
      { id: 'd1', expediente_id: 'e1', tipo: 'pasaporte', version: 1, mime: 'image/jpeg', bytes: 10, capturado_en: '2026-11-24T10:00:00Z' },
      { id: 'd2', expediente_id: 'e1', tipo: 'pasaporte', version: 2, mime: 'image/jpeg', bytes: 10, capturado_en: '2026-11-24T11:00:00Z' },
      { id: 'd3', expediente_id: 'e1', tipo: 'regcard', version: 1, mime: 'image/jpeg', bytes: 10, capturado_en: '2026-11-24T11:00:00Z' },
    ],
    docs_grupo: [{ id: 'g1', tipo: 'contrato', nombre_archivo: 'Contrato firmado.pdf', mime: 'application/pdf', bytes: 5, subido_por_nombre: 'Grupos', subido_en: '2026-11-20T10:00:00Z' }],
    docs_credito: [{ id: 'c1', tipo: 'extraordinario', descripcion: 'Carta del banco', nombre_archivo: 'carta.pdf', mime: 'application/pdf', bytes: 5, subido_por_nombre: 'Crédito', subido_en: '2026-11-21T10:00:00Z' }],
    evento: { tipo: 'congreso', organizador: 'Org', pais: 'Canadá' },
    folio_maestra: '12345',
    descargado: { por: 'Impuestos', en: '2026-11-24T12:00:00Z' },
  };
  it('pone cada documento en su sección y las versiones viejas aparte', () => {
    const { raiz, lista } = planear(p);
    expect(raiz).toBe('PRUEBA-0001');
    expect(lista.map((a) => a.ruta)).toEqual([
      'PRUEBA-0001/1 Documentos del evento/01 Contrato del evento - Contrato firmado.pdf',
      'PRUEBA-0001/2 Documentos de Credito/04 Documentos extraordinarios - Carta del banco - carta.pdf',
      'PRUEBA-0001/3 Huespedes/EXP-12 Carter, Emily/1 Pasaporte.jpg',
      'PRUEBA-0001/3 Huespedes/EXP-12 Carter, Emily/Versiones reemplazadas/1 Pasaporte (version 1).jpg',
      'PRUEBA-0001/3 Huespedes/EXP-12 Carter, Emily/2 Registration card.jpg',
    ]);
    expect(lista[2].url).toBe('/api/documentos/d2/imagen');
    const x = indiceExcel(p, lista);
    expect(x[0]).toBe(0x50);
  });
});
