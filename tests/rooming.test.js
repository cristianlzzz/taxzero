// Lectura de la rooming list (datos ficticios con la estructura del reporte de Opera).
import { describe, expect, it } from 'vitest';
import { fechaCelda, leerCSV, leerOpera, leerTabla, nombreLibre, nombreOpera, paisDe, renglones, revisar } from '../src/client/rooming.js';

const OPERA = [
  'Fairmont Mayakoba 11-24-26',
  'Fairmont - Group Rooming List',
  'Room Name Conf. No. Arr. Dep. Room Res. Adl. Chl. Nts. Rms.',
  'Block Code PRUEBA_001 Congreso de Prueba 2027',
  '0101 Carter,Emily 900000101 03-10-27 03-14-27 PK1N CKOT 2 0 4 1',
  'Accompanying Names: Daniel Carter',
  '0102 Brooks,Michael,Mr 900000102 03-09-27 03-10-27 PQ2N CKOT 1 0 1 1',
  '0102 Brooks,Michael James 900000103 03-10-27 03-14-27 PQ2N CKOT 1 0 4 1',
  '0103 *Nguyen,Sarah,Ms 900000104 03-10-27 03-14-27 DQ2N RES 1 0 4 1',
  '0104 *Kowalski LCO 16 HRS,* 900000105 03-13-27 03-14-27 PK1N CKOT 1 0 0 0',
  'Kim,Ji-woo 900000106 03-10-27 03-14-27 DK1N NOSH 1 0 4 1',
  '0105 Mason White,Laura,Mrs 900000107 03-10-27 03-14-27 PK1N CKOT 2 0 4 1',
  'Accompanying Names: White, Peter',
  'Total Block Code PRUEBA_001 Congreso de Prueba Reservations 7 9 0 21 6',
  'Filter From Stay Date 03-01-27 To Stay Date 03-31-27 Page 1 of 1 grprmlist',
];

describe('nombres de Opera', () => {
  it('separa apellidos y nombre, quita título y asterisco', () => {
    expect(nombreOpera('Wells,Edward,Mr')).toEqual({ nombre: 'Edward', apellidos: 'Wells' });
    expect(nombreOpera('*Rekowski,Travis William')).toEqual({ nombre: 'Travis William', apellidos: 'Rekowski' });
    expect(nombreOpera('Mason White,Jacob,MR')).toEqual({ nombre: 'Jacob', apellidos: 'Mason White' });
    expect(nombreOpera('*Kutzer LCO 16 HRS,*')).toEqual({ nombre: '', apellidos: 'Kutzer LCO 16 HRS' });
  });
  it('adivina acompañantes escritos de corrido', () => {
    expect(nombreLibre('Jessica Hook')).toEqual({ nombre: 'Jessica', apellidos: 'Hook' });
    expect(nombreLibre('Hook, Jessica')).toEqual({ nombre: 'Jessica', apellidos: 'Hook' });
    expect(nombreLibre('Kristin Barde, Kristin')).toEqual({ nombre: 'Kristin', apellidos: 'Barde' });
  });
});

describe('reporte Group Rooming List', () => {
  it('lee las reservaciones con habitación y número de reservación', () => {
    const r = leerOpera(OPERA);
    expect(r.filas).toHaveLength(7);
    expect(r.total).toBe(7);
    expect(r.bloque).toBe('PRUEBA_001 Congreso de Prueba 2027');
    const f = r.filas[0];
    expect(f).toMatchObject({ nombre: 'Emily', apellidos: 'Carter', llegada: '2027-03-10', salida: '2027-03-14', estado: 'CKOT', acompanantes: ['Daniel Carter'] });
    expect(f).toMatchObject({ habitacion: '0101', reservacion: '900000101' });
    expect(r.filas[5]).toMatchObject({ habitacion: '', reservacion: '900000106' });
    expect(JSON.stringify(r.filas)).not.toMatch(/PK1N/);
    expect(r.filas[5]).toMatchObject({ nombre: 'Ji-woo', apellidos: 'Kim', estado: 'NOSH' });
  });

  it('junta los textos del PDF en renglones', () => {
    const items = [
      { str: 'Carter,Emily', x: 45, y: 479 }, { str: '900000101', x: 149, y: 479 }, { str: '0101', x: 7, y: 479.5 },
      { str: 'Accompanying Names: Daniel Carter', x: 45, y: 467 }, { str: ' ', x: 60, y: 467 },
    ];
    expect(renglones(items)).toEqual(['0101 Carter,Emily 900000101', 'Accompanying Names: Daniel Carter']);
  });

  it('marca repetidos, cancelados y problemas en la vista previa', () => {
    const v = revisar(leerOpera(OPERA).filas, [{ nombre: 'Emily', apellidos: 'Carter' }], { llegada: '2027-03-10', salida: '2027-03-14' });
    const por = (ap) => v.filter((f) => f.apellidos === ap);
    expect(por('Carter')[0]).toMatchObject({ incluir: false, dup: 'Ya está dado de alta en el grupo' });
    // Dos reservaciones de Michael Brooks: queda la del nombre más completo.
    const [b1, b2] = por('Brooks');
    expect(b1.incluir).toBe(false);
    expect(b1.dup).toMatch(/Se repite con la fila 3/);
    expect(b2).toMatchObject({ incluir: true, nombre: 'Michael James' });
    expect(por('Kim')[0]).toMatchObject({ incluir: false, fuera: 'No show en Opera' });
    expect(por('Kowalski LCO 16 HRS')[0].problemas).toContain('Falta el nombre');
    // Opera no trae nacionalidad: todas la piden.
    expect(v.every((f) => f.problemas.includes('Falta la nacionalidad'))).toBe(true);
  });

  it('agrega acompañantes solo si se pide', () => {
    const base = leerOpera(OPERA).filas;
    expect(revisar(base).length).toBe(7);
    const v = revisar(base, [], {}, { acompanantes: true });
    expect(v.length).toBe(9);
    const p = v.find((f) => f.origen === 'acompanante' && f.apellidos === 'White');
    expect(p).toMatchObject({ nombre: 'Peter', de: 'Laura Mason White' });
    expect(p.avisos[0]).toMatch(/Acompañante de Laura Mason White/);
  });
});

describe('Excel y CSV', () => {
  const tabla = [
    ['DOCUMENTO DE PRUEBA'],
    [],
    ['#', 'Apellido', 'Nombre', 'Nacionalidad', 'Pasaporte', 'Vencimiento del pasaporte', 'Llegada', 'Salida', 'Room No.', 'Conf. No.'],
    [1, 'Carter', 'Emily', 'Estados Unidos', 'prb 100001', '31/12/2030', '10/03/2027', '14/03/2027', '0101', '900000101'],
    [2, 'Tremblay', 'Sophie', 'CA', 'PRB100009', 47848, '10/03/2027', '14/03/2027', '0102', '900000102'],
    [3, 'Rossi', 'Isabella', 'Italia', '', '', '', '', '', ''],
    [4, 'Tanaka', 'Kenji', 'Marte', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
  ];
  it('encuentra los títulos y lee los datos que sirven', () => {
    const { filas } = leerTabla(tabla);
    expect(filas).toHaveLength(4);
    expect(filas[0]).toMatchObject({ nombre: 'Emily', apellidos: 'Carter', pasaporte: 'PRB100001', vence: '2030-12-31', llegada: '2027-03-10' });
    expect(filas[1].vence).toBe('2030-12-31');
    expect(filas[0]).toMatchObject({ habitacion: '0101', reservacion: '900000101' });
    const v = revisar(filas);
    expect(v.map((f) => f.nac)).toEqual(['USA', 'CAN', 'ITA', '']);
    expect(v[3].problemas[0]).toBe('Elige la nacionalidad (el archivo dice "Marte")');
  });
  it('lee una columna "Name" al estilo de Opera', () => {
    const { filas } = leerTabla([['Room No.', 'Name', 'Nationality'], ['0101', 'Hook,Ryan,Mr', 'US']]);
    expect(filas[0]).toMatchObject({ nombre: 'Ryan', apellidos: 'Hook', nacionalidad: 'US' });
    expect(paisDe('US')).toBe('USA');
  });
  it('avisa si no hay títulos', () => {
    expect(leerTabla([['a', 'b'], ['c', 'd']]).sinTitulos).toBe(true);
  });
  it('lee CSV con comillas y punto y coma', () => {
    expect(leerCSV('Apellido;Nombre\n"Müller";"Thomas"\r\nO\'Connor;Daniel\n')).toEqual([['Apellido', 'Nombre'], ['Müller', 'Thomas'], ["O'Connor", 'Daniel']]);
  });
  it('no adivina fechas ambiguas', () => {
    expect(fechaCelda('03/04/2030')).toEqual({ fecha: '', ambigua: true });
    expect(fechaCelda('03/04/2030', 'dmy').fecha).toBe('2030-04-03');
    expect(fechaCelda('2030-04-03').fecha).toBe('2030-04-03');
  });
});

describe('archivos de prueba', () => {
  it('lee el PDF ficticio con la estructura del reporte de Opera', async () => {
    const fs = await import('node:fs');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(new URL('./fixtures/rooming-list-opera-prueba.pdf', import.meta.url)));
    const doc = await getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
    const lineas = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      lineas.push(...renglones(tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))));
    }
    const r = leerOpera(lineas);
    expect(r.filas).toHaveLength(44);
    expect(r.total).toBe(44);
    const v = revisar(r.filas);
    expect(v.filter((f) => f.incluir)).toHaveLength(40);
    expect(v.find((f) => f.apellidos === 'Carter')).toMatchObject({ nombre: 'Emily', acompanantes: ['Daniel Carter'] });
  });

  it('lee el Excel ficticio', async () => {
    const fs = await import('node:fs');
    const { leerXlsx } = await import('../src/client/lector-xlsx.js');
    const b = fs.readFileSync(new URL('./fixtures/rooming-list-prueba.xlsx', import.meta.url));
    const { filas } = leerTabla(await leerXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)));
    expect(filas.map((f) => [f.nombre, f.apellidos, paisDe(f.nacionalidad), f.vence])).toEqual([
      ['Emily', 'Carter', 'USA', '2030-12-31'], ['Sophie', 'Tremblay', 'CAN', ''], ['Thomas', 'Müller', 'DEU', ''],
    ]);
    expect(filas[2].llegada).toBe('2027-03-10');
  });
});

describe('XML de Opera', () => {
  it('lee las reservaciones y detecta repetidos por perfil del huésped', async () => {
    const fs = await import('node:fs');
    const { leerOperaXML } = await import('../src/client/rooming.js');
    const r = leerOperaXML(fs.readFileSync(new URL('./fixtures/rooming-list-opera-prueba.xml', import.meta.url), 'utf8'));
    expect(r.filas).toHaveLength(9);
    expect(r.total).toBe(9);
    expect(r.bloque).toBe('PRUEBA_0001 Congreso de Prueba Taxzero 2027');
    expect(r.filas[0]).toMatchObject({ nombre: 'Emily', apellidos: 'Carter', llegada: '2027-03-10', salida: '2027-03-14', acompanantes: ['Daniel Carter'], perfil: '70000001' });
    expect(r.filas[6]).toMatchObject({ nombre: 'Thomas', apellidos: 'Müller' });
    expect(r.filas[5].apellidos).toBe("O'Connor");
    expect(r.filas[0]).toMatchObject({ habitacion: '0101', reservacion: '900000101' });
    expect(JSON.stringify(r.filas)).not.toMatch(/PK1N|No debe leerse/);
    const v = revisar(r.filas);
    expect(v.filter((f) => f.incluir)).toHaveLength(7);
    expect(v[1].dup).toMatch(/Se repite con la fila 3/);
    expect(v[7].fuera).toBe('No show en Opera');
  });
  it('une repetidos por perfil aunque el nombre sea distinto', () => {
    const base = [
      { nombre: 'Bob', apellidos: 'Smith', perfil: '1', acompanantes: [] },
      { nombre: 'Robert', apellidos: 'Smith Jr', perfil: '1', acompanantes: [] },
    ];
    const v = revisar(base);
    expect(v.filter((f) => f.incluir)).toHaveLength(1);
    expect(v.find((f) => f.incluir).nombre).toBe('Robert');
  });
  it('rechaza XML que no es de Opera', async () => {
    const { leerOperaXML } = await import('../src/client/rooming.js');
    expect(leerOperaXML('<x><y/></x>')).toBeNull();
  });
});
