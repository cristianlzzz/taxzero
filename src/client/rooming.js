// Lectura de la rooming list para dar de alta huéspedes en bloque.
// Funciones puras (sin pantalla) para poder probarlas: reciben texto o tablas y regresan filas.
// También toma habitación y número de reservación de Opera cuando vienen en el archivo.
import { PAISES } from './catalogos.js';

// Texto comparable: sin acentos, sin signos, minúsculas y espacios simples.
export const comparable = (t) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const TITULOS = new Set(['mr', 'mrs', 'ms', 'miss', 'mstr', 'master', 'dr', 'prof', 'sr', 'sra', 'srta', 'sir', 'mx', 'rev']);

// Estados de reservación de Opera que no deben darse de alta por omisión.
const ESTADOS_FUERA = {
  CXL: 'Reservación cancelada en Opera', CANCEL: 'Reservación cancelada en Opera', CANCELLED: 'Reservación cancelada en Opera',
  NS: 'No show en Opera', NOSH: 'No show en Opera', NOSHOW: 'No show en Opera', 'NO SHOW': 'No show en Opera', WAIT: 'En lista de espera en Opera', WL: 'En lista de espera en Opera',
};
const ESTADOS_OPERA = new Set(['RES', 'RESERVED', 'CKIN', 'CKOT', 'INHS', 'DUEIN', 'DUEOUT', 'DI', 'DO', 'PM', 'TENT', ...Object.keys(ESTADOS_FUERA)]);

// "Apellido,Nombre,Título" de Opera. Quita el asterisco de VIP o compartida y el título.
export function nombreOpera(crudo) {
  const partes = String(crudo || '').replace(/\*/g, '').split(',').map((s) => s.replace(/\s+/g, ' ').trim());
  while (partes.length > 1 && (TITULOS.has(comparable(partes[partes.length - 1])) || !partes[partes.length - 1])) partes.pop();
  const apellidos = partes[0] || '';
  const nombre = partes.slice(1).join(' ').trim();
  return { nombre, apellidos };
}

// Nombre escrito de corrido ("Jessica Hook" o "Hook, Jessica"): se adivina y se marca para revisar.
export function nombreLibre(crudo) {
  const s = String(crudo || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  if (s.includes(',')) {
    const [antes, despues] = s.split(',').map((x) => x.trim());
    // Opera a veces repite el nombre: "Kristin Barde, Kristin" es Kristin Barde.
    const pal = comparable(antes).split(' ');
    if (despues && pal.length > 1 && pal[0] === comparable(despues)) return libreSinComa(antes);
    return nombreOpera(s);
  }
  return libreSinComa(s);
}
function libreSinComa(s) {
  const pal = s.split(' ').filter((p) => !TITULOS.has(comparable(p)));
  if (pal.length < 2) return { nombre: pal.join(' '), apellidos: '' };
  return { nombre: pal.slice(0, -1).join(' '), apellidos: pal[pal.length - 1] };
}

// ------------------------------------------------------------------ PDF de Opera
// Junta los textos de una página del PDF en renglones (de arriba hacia abajo, de izquierda a derecha).
export function renglones(items) {
  const filas = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    let f = filas.find((r) => Math.abs(r.y - it.y) <= 2.5);
    if (!f) filas.push((f = { y: it.y, items: [] }));
    f.items.push(it);
  }
  return filas
    .sort((a, b) => b.y - a.y)
    .map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' ').replace(/\s+/g, ' '));
}

const FECHA = String.raw`\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}`;
const RE_RESERVA = new RegExp(String.raw`^(?:(\d{1,5}[A-Z]?)\s+)?(.+?)\s+(\d{5,12})\s+(${FECHA})\s+(${FECHA})(?:\s+(.*))?$`);

// Opera imprime las fechas como MM-DD-AA.
export function fechaOpera(s) {
  const m = String(s || '').match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!m) return '';
  let [, mes, dia, anio] = m.map(Number);
  if (mes > 12 && dia <= 12) [mes, dia] = [dia, mes];
  if (anio < 100) anio += 2000;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return '';
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Lee los renglones del reporte "Group Rooming List" de Opera.
export function leerOpera(lineas) {
  const filas = [];
  let total = null;
  let bloque = '';
  for (const l of lineas) {
    let m;
    if ((m = l.match(/Grand Total\s+Reservations\s+(\d+)/i))) {
      total = +m[1];
      continue;
    }
    if ((m = l.match(/^Total Block Code.*Reservations\s+(\d+)/i))) {
      total = total == null ? +m[1] : total;
      if (!/Grand/i.test(l)) filas.subtotal = (filas.subtotal || 0) + +m[1];
      continue;
    }
    if ((m = l.match(/^Block Code\s*(.+)$/i)) && !bloque) {
      bloque = m[1].trim();
      continue;
    }
    if ((m = l.match(/^Accompanying Names?:\s*(.*)$/i))) {
      const ult = filas[filas.length - 1];
      if (ult && m[1].trim()) ult.acompanantes.push(m[1].trim());
      continue;
    }
    if (!(m = l.match(RE_RESERVA))) continue;
    const [, hab = '', nombreCrudo, conf, arr, dep, resto = ''] = m;
    const tokens = resto.split(' ').filter(Boolean);
    const nums = [];
    while (tokens.length && /^\d+$/.test(tokens[tokens.length - 1]) && nums.length < 4) nums.unshift(+tokens.pop());
    const estado = tokens.find((t) => ESTADOS_OPERA.has(t.toUpperCase())) || (tokens.length > 1 ? tokens[tokens.length - 1] : '');
    const { nombre, apellidos } = nombreOpera(nombreCrudo);
    filas.push({
      nombre, apellidos, original: nombreCrudo.trim(), habitacion: hab, reservacion: conf, llegada: fechaOpera(arr), salida: fechaOpera(dep),
      estado: estado.toUpperCase(), noches: nums.length === 4 ? nums[2] : null, acompanantes: [],
      nacionalidad: '', pasaporte: '', vence: '',
    });
  }
  // Si hay subtotales por bloque, el total general es su suma.
  if (total == null && filas.subtotal) total = filas.subtotal;
  delete filas.subtotal;
  return { filas, total, bloque };
}

// ------------------------------------------------------------------ XML de Opera
const ENT_XML = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlTexto = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT_XML[e] ?? m).trim();

// Lee el XML del reporte "Group Rooming List" de Opera (grprmlist). Solo toma lo que sirve para el
// alta: nombre, habitación, reservación, fechas, estado, perfil del huésped (para detectar repetidos)
// y acompañantes. Ignora tarifas y datos de pago aunque vengan en el archivo.
export function leerOperaXML(texto) {
  if (!/<GRPRMLIST\b/.test(texto) || !/<G_CONFIRMATION_NO>/.test(texto)) return null;
  const campo = (b, t) => {
    const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
    return m ? xmlTexto(m[1]) : '';
  };
  const filas = [];
  for (const m of texto.matchAll(/<G_CONFIRMATION_NO>([\s\S]*?)<\/G_CONFIRMATION_NO>/g)) {
    // Las tarifas vienen anidadas dentro de cada reservación; no se usan.
    const b = m[1].replace(/<LIST_G_RATE_CHANGES>[\s\S]*?<\/LIST_G_RATE_CHANGES>/g, '');
    const original = campo(b, 'FULL_NAME');
    const { nombre, apellidos } = nombreOpera(original);
    const acomp = campo(b, 'ACCOMPANYING_NAMES');
    const noches = campo(b, 'NIGHTS');
    filas.push({
      nombre, apellidos, original, habitacion: campo(b, 'ROOM'), reservacion: campo(b, 'CONFIRMATION_NO'), llegada: fechaOpera(campo(b, 'ARRIVAL')), salida: fechaOpera(campo(b, 'DEPARTURE')),
      estado: campo(b, 'SHORT_RESV_STATUS').toUpperCase(), noches: noches === '' ? null : +noches,
      acompanantes: acomp ? [acomp] : [], perfil: campo(b, 'GUEST_NAME_ID'), nacionalidad: '', pasaporte: '', vence: '',
    });
  }
  const parciales = [...texto.matchAll(/<CS_RESERVATIONS_GRP2>\s*(\d+)\s*</g)].map((x) => +x[1]);
  const g1 = texto.match(/<G_GRP1>[\s\S]*?<GRP1_DESC>([\s\S]*?)<\/GRP1_DESC>/);
  return { filas, total: parciales.length ? parciales.reduce((a, b) => a + b, 0) : null, bloque: g1 ? xmlTexto(g1[1]) : '' };
}

// ------------------------------------------------------------------ Excel o CSV
const COLUMNAS = {
  apellidos: ['apellido', 'apellidos', 'last name', 'lastname', 'surname', 'family name', 'apellido paterno'],
  nombre: ['nombre', 'nombres', 'nombre s', 'first name', 'firstname', 'given name', 'given names', 'first'],
  completo: ['name', 'guest name', 'guest', 'nombre completo', 'huesped', 'full name', 'nombre del huesped'],
  nacionalidad: ['nacionalidad', 'nationality', 'pais', 'country', 'citizenship', 'pais de origen'],
  pasaporte: ['pasaporte', 'passport', 'no pasaporte', 'no de pasaporte', 'numero de pasaporte', 'passport number', 'passport no', 'passport #'],
  vence: ['vencimiento', 'vencimiento del pasaporte', 'vencimiento pasaporte', 'passport expiration', 'passport expiry', 'expiration', 'expiry', 'expiration date', 'expiry date'],
  llegada: ['llegada', 'arrival', 'arr', 'arr date', 'arrival date', 'fecha de llegada', 'check in'],
  salida: ['salida', 'departure', 'dep', 'dep date', 'departure date', 'fecha de salida', 'check out'],
  estado: ['status', 'res status', 'reservation status', 'estado', 'estatus'],
  habitacion: ['room', 'room no', 'room number', 'habitacion', 'no habitacion', 'no de habitacion', 'numero de habitacion', 'hab'],
  reservacion: ['conf no', 'conf', 'confirmation', 'confirmation no', 'confirmation number', 'reservacion', 'no reservacion', 'no de reservacion', 'numero de reservacion', 'reserva', 'confirmacion'],
  acompanantes: ['comparte con', 'accompanying names', 'accompanying', 'sharer', 'sharers', 'shares with', 'acompanante', 'acompanantes'],
};
const columnaDe = (titulo) => {
  const t = comparable(titulo);
  return Object.keys(COLUMNAS).find((k) => COLUMNAS[k].includes(t)) || null;
};

// Fecha de una celda de Excel o de texto. Si es ambigua (03/04/2027) regresa ambigua: true.
// orden: 'dmy' o 'mdy' cuando el resto del archivo ya dejó claro cómo vienen las fechas.
export function fechaCelda(v, orden = '') {
  if (v == null || v === '') return { fecha: '' };
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { fecha: d.toISOString().slice(0, 10) };
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return { fecha: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    let dia, mes;
    if (a > 12 && b <= 12) [dia, mes] = [a, b];
    else if (b > 12 && a <= 12) [dia, mes] = [b, a];
    else if (a === b || orden === 'dmy') [dia, mes] = [a, b];
    else if (orden === 'mdy') [dia, mes] = [b, a];
    else return { fecha: '', ambigua: true };
    return { fecha: `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}` };
  }
  return { fecha: '' };
}

// Lee una tabla (lista de renglones con celdas). Busca el renglón de títulos en las primeras 40 filas.
export function leerTabla(matriz) {
  let cab = -1;
  let mapa = null;
  for (let i = 0; i < Math.min(matriz.length, 40); i++) {
    const m = {};
    (matriz[i] || []).forEach((celda, j) => {
      const k = columnaDe(celda);
      if (k && m[k] == null) m[k] = j;
    });
    const tieneNombre = m.completo != null || (m.nombre != null && m.apellidos != null);
    if (tieneNombre && Object.keys(m).length >= 2) {
      cab = i;
      mapa = m;
      break;
    }
  }
  if (cab < 0) return { filas: [], sinTitulos: true };
  const val = (r, k) => (mapa[k] == null ? '' : r[mapa[k]] ?? '');
  const txt = (r, k) => String(val(r, k)).replace(/\s+/g, ' ').trim();
  // Si alguna fecha del archivo deja claro el orden (31/03 o 03/31), se aplica a todas.
  let orden = '';
  for (const r of matriz.slice(cab + 1)) {
    for (const k of ['vence', 'llegada', 'salida']) {
      const m = String(val(r, k)).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/);
      if (m && +m[1] > 12 && +m[2] <= 12) orden = orden === 'mdy' ? 'x' : 'dmy';
      if (m && +m[2] > 12 && +m[1] <= 12) orden = orden === 'dmy' ? 'x' : 'mdy';
    }
  }
  if (orden === 'x') orden = '';
  const filas = [];
  for (const r of matriz.slice(cab + 1)) {
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue;
    let nombre = txt(r, 'nombre');
    let apellidos = txt(r, 'apellidos');
    let original = `${apellidos}${apellidos && nombre ? ', ' : ''}${nombre}`;
    if (!nombre && !apellidos && mapa.completo != null) {
      original = txt(r, 'completo');
      ({ nombre, apellidos } = original.includes(',') ? nombreOpera(original) : nombreLibre(original));
    }
    if (!nombre && !apellidos) continue;
    // Renglones de totales al final de la hoja.
    if (/^(total|grand total|totales?)\b/i.test(original)) continue;
    const v = fechaCelda(val(r, 'vence'), orden);
    const acomp = txt(r, 'acompanantes');
    filas.push({
      nombre, apellidos, original, nacionalidad: txt(r, 'nacionalidad'), habitacion: txt(r, 'habitacion'), reservacion: txt(r, 'reservacion'),
      pasaporte: txt(r, 'pasaporte').replace(/\s/g, '').toUpperCase(),
      vence: v.fecha, venceAmbigua: !!v.ambigua,
      llegada: fechaCelda(val(r, 'llegada'), orden).fecha, salida: fechaCelda(val(r, 'salida'), orden).fecha,
      estado: txt(r, 'estado').toUpperCase(), noches: null, acompanantes: acomp ? [acomp] : [],
    });
  }
  return { filas, total: null, bloque: '' };
}

// CSV sencillo (coma o punto y coma, con comillas).
export function leerCSV(texto) {
  const sep = (texto.split('\n')[0].match(/;/g) || []).length > (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const filas = [];
  let fila = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i++; } else if (ch === '"') comillas = false; else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(celda); celda = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += ch;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

// ------------------------------------------------------------------ nacionalidad
const ISO2 = 'AF AFG AL ALB DE DEU AD AND AO AGO AG ATG SA SAU DZ DZA AR ARG AM ARM AU AUS AT AUT AZ AZE BS BHS BD BGD BB BRB BH BHR BE BEL BZ BLZ BJ BEN BY BLR BO BOL BA BIH BW BWA BR BRA BN BRN BG BGR BF BFA BI BDI BT BTN CV CPV KH KHM CM CMR CA CAN QA QAT TD TCD CL CHL CN CHN CY CYP CO COL KM COM KP PRK KR KOR CI CIV CR CRI HR HRV CU CUB DK DNK DM DMA EC ECU EG EGY SV SLV AE ARE ER ERI SK SVK SI SVN ES ESP US USA EE EST SZ SWZ ET ETH PH PHL FI FIN FJ FJI FR FRA GA GAB GM GMB GE GEO GH GHA GD GRD GR GRC GT GTM GN GIN GQ GNQ GW GNB GY GUY HT HTI HN HND HU HUN IN IND ID IDN IQ IRQ IR IRN IE IRL IS ISL MH MHL SB SLB IL ISR IT ITA JM JAM JP JPN JO JOR KZ KAZ KE KEN KG KGZ KI KIR KW KWT LA LAO LS LSO LV LVA LB LBN LR LBR LY LBY LI LIE LT LTU LU LUX MK MKD MG MDG MY MYS MW MWI MV MDV ML MLI MT MLT MA MAR MU MUS MR MRT MX MEX FM FSM MD MDA MC MCO MN MNG ME MNE MZ MOZ MM MMR NA NAM NR NRU NP NPL NI NIC NE NER NG NGA NO NOR NZ NZL OM OMN NL NLD PK PAK PW PLW PA PAN PG PNG PY PRY PE PER PL POL PT PRT GB GBR UK GBR CF CAF CZ CZE CG COG CD COD DO DOM RW RWA RO ROU RU RUS WS WSM KN KNA SM SMR VC VCT LC LCA ST STP SN SEN RS SRB SC SYC SL SLE SG SGP SY SYR SO SOM LK LKA ZA ZAF SD SDN SS SSD SE SWE CH CHE SR SUR TH THA TW TWN TZ TZA TJ TJK TL TLS TG TGO TO TON TT TTO TN TUN TM TKM TR TUR TV TUV UA UKR UG UGA UY URY UZ UZB VU VUT VA VAT VE VEN VN VNM YE YEM DJ DJI ZM ZMB ZW ZWE'.split(' ');
const EN = {
  'united states': 'USA', 'united states of america': 'USA', usa: 'USA', 'u s a': 'USA', 'u s': 'USA', american: 'USA', 'estados unidos de america': 'USA', eua: 'USA', eeuu: 'USA',
  canada: 'CAN', canadian: 'CAN', 'united kingdom': 'GBR', 'great britain': 'GBR', england: 'GBR', scotland: 'GBR', wales: 'GBR', british: 'GBR', inglaterra: 'GBR',
  germany: 'DEU', german: 'DEU', france: 'FRA', french: 'FRA', spain: 'ESP', spanish: 'ESP', italy: 'ITA', italian: 'ITA', netherlands: 'NLD', holland: 'NLD', holanda: 'NLD', dutch: 'NLD',
  brazil: 'BRA', brazilian: 'BRA', argentina: 'ARG', colombia: 'COL', mexico: 'MEX', mexican: 'MEX', mexicana: 'MEX', mexicano: 'MEX', japan: 'JPN', japanese: 'JPN', china: 'CHN', chinese: 'CHN',
  india: 'IND', indian: 'IND', australia: 'AUS', australian: 'AUS', ireland: 'IRL', irish: 'IRL', switzerland: 'CHE', swiss: 'CHE', sweden: 'SWE', swedish: 'SWE', norway: 'NOR', norwegian: 'NOR',
  denmark: 'DNK', danish: 'DNK', finland: 'FIN', belgium: 'BEL', portugal: 'PRT', austria: 'AUT', poland: 'POL', 'czech republic': 'CZE', czechia: 'CZE', greece: 'GRC', turkey: 'TUR', turkiye: 'TUR',
  russia: 'RUS', ukraine: 'UKR', israel: 'ISR', 'south korea': 'KOR', korea: 'KOR', 'republic of korea': 'KOR', singapore: 'SGP', 'new zealand': 'NZL', 'south africa': 'ZAF', philippines: 'PHL',
  vietnam: 'VNM', 'viet nam': 'VNM', thailand: 'THA', malaysia: 'MYS', indonesia: 'IDN', taiwan: 'TWN', 'hong kong': 'CHN', chile: 'CHL', peru: 'PER', uruguay: 'URY', paraguay: 'PRY',
  ecuador: 'ECU', venezuela: 'VEN', 'costa rica': 'CRI', panama: 'PAN', guatemala: 'GTM', 'dominican republic': 'DOM', 'puerto rico': 'USA', 'united arab emirates': 'ARE', uae: 'ARE',
  'saudi arabia': 'SAU', egypt: 'EGY', hungary: 'HUN', romania: 'ROU', croatia: 'HRV', iceland: 'ISL', luxembourg: 'LUX', 'el salvador': 'SLV', honduras: 'HND', nicaragua: 'NIC', cuba: 'CUB', jamaica: 'JAM', bahamas: 'BHS',
};
const POR_NOMBRE = new Map(PAISES.map(([n, c]) => [comparable(n), c]));
const CODIGOS = new Set(PAISES.map((p) => p[1]));
const DE_ISO2 = new Map();
for (let i = 0; i < ISO2.length; i += 2) DE_ISO2.set(ISO2[i], ISO2[i + 1]);

// Código de país (ISO de 3 letras) a partir de lo que diga el archivo, o '' si no se reconoce.
export function paisDe(texto) {
  const s = String(texto || '').trim();
  if (!s) return '';
  const up = s.toUpperCase();
  if (up.length === 3 && CODIGOS.has(up)) return up;
  if (up.length === 2 && DE_ISO2.has(up)) return DE_ISO2.get(up);
  const t = comparable(s);
  return POR_NOMBRE.get(t) || EN[t] || '';
}
export const nombrePais = (codigo) => (PAISES.find((p) => p[1] === codigo) || [''])[0];

// ------------------------------------------------------------------ revisión
const claveExacta = (f) => `${comparable(f.nombre)}|${comparable(f.apellidos)}`;
const claveParecida = (f) => `${comparable(f.apellidos)}|${comparable(f.nombre).split(' ')[0]}`;

// Arma la lista de la vista previa: agrega acompañantes si se pidió, marca duplicados y problemas.
// existentes: huéspedes ya dados de alta en el grupo. grupo: { llegada, salida } (AAAA-MM-DD).
export function revisar(base, existentes = [], grupo = {}, { acompanantes = false } = {}) {
  const lista = [];
  base.forEach((f, i) => {
    lista.push({ ...f, origen: 'archivo', ref: i + 1 });
    if (acompanantes) {
      for (const a of f.acompanantes || []) {
        const n = nombreLibre(a);
        lista.push({
          ...n, original: a, origen: 'acompanante', de: `${f.nombre} ${f.apellidos}`.trim(), ref: i + 1,
          nacionalidad: f.nacionalidad, pasaporte: '', vence: '', habitacion: f.habitacion || '', reservacion: '', llegada: f.llegada, salida: f.salida, estado: f.estado, noches: f.noches, acompanantes: [],
        });
      }
    }
  });
  const yaExacta = new Map(existentes.map((e) => [claveExacta(e), e]));
  const yaParecida = new Map(existentes.map((e) => [claveParecida(e), e]));
  const filas = lista.map((f, i) => {
    const fila = {
      ...f, n: i + 1, nac: paisDe(f.nacionalidad), avisos: [], problemas: [], dup: '', fuera: ESTADOS_FUERA[f.estado] || '', incluir: true, dupOk: false,
    };
    return revisarProblemas(fila, grupo);
  });
  // Misma persona con varias reservaciones: se queda la fila con el nombre más completo
  // (y que no esté cancelada); las demás se marcan como repetidas.
  // Se agrupan por nombre parecido y, si el archivo lo trae (XML de Opera), por el perfil del huésped.
  const grupoDe = new Map(); // clave → arreglo compartido
  const grupos = new Set();
  for (const f of filas) {
    if (!f.nombre || !f.apellidos) continue;
    const e = yaExacta.get(claveExacta(f)) || yaParecida.get(claveParecida(f));
    if (e) {
      f.dup = yaExacta.has(claveExacta(f)) ? 'Ya está dado de alta en el grupo' : `Parecido a ${e.nombre} ${e.apellidos}, que ya está dado de alta`;
      continue;
    }
    const claves = [`n:${claveParecida(f)}`, ...(f.perfil ? [`p:${f.perfil}`] : [])];
    let g = claves.map((k) => grupoDe.get(k)).find(Boolean);
    if (!g) grupos.add((g = []));
    for (const k of claves) {
      const otro = grupoDe.get(k);
      if (otro && otro !== g) {
        g.push(...otro);
        grupos.delete(otro);
        for (const [kk, v] of grupoDe) if (v === otro) grupoDe.set(kk, g);
      }
      grupoDe.set(k, g);
    }
    g.push(f);
  }
  for (const g of grupos) {
    if (g.length < 2) continue;
    const largo = (f) => (f.fuera ? 0 : 1000) + `${f.nombre} ${f.apellidos}`.length - f.n / 10000;
    const queda = g.reduce((a, b) => (largo(b) > largo(a) ? b : a));
    for (const f of g) if (f !== queda) f.dup = `Se repite con la fila ${queda.n} (otra reservación de la misma persona)`;
  }
  for (const f of filas) if (f.dup || f.fuera) f.incluir = false;
  return filas;
}

// Problemas impiden el alta hasta corregirlos; avisos solo informan.
export function revisarProblemas(f, grupo = {}) {
  f.problemas = [];
  f.avisos = [];
  if (!f.nombre.trim()) f.problemas.push('Falta el nombre');
  if (!f.apellidos.trim()) f.problemas.push('Faltan los apellidos');
  if (/\d/.test(f.nombre + f.apellidos)) f.problemas.push('El nombre tiene números; corrígelo como viene en el pasaporte');
  if (f.nombre.length > 120 || f.apellidos.length > 120) f.problemas.push('El nombre es demasiado largo');
  if (!f.nac) f.problemas.push(f.nacionalidad && !paisDe(f.nacionalidad) ? `Elige la nacionalidad (el archivo dice "${f.nacionalidad}")` : 'Falta la nacionalidad');
  if (f.pasaporte && f.pasaporte.length > 30) f.problemas.push('El número de pasaporte es demasiado largo');
  if ((f.habitacion || '').length > 10 || (f.reservacion || '').length > 20) f.problemas.push('La habitación o la reservación son demasiado largas');
  if (f.nac === 'MEX') f.avisos.push('Nacionalidad mexicana: no aplica para tax free');
  if (f.origen === 'acompanante') f.avisos.push(`Acompañante de ${f.de}. Revisa cuál es el nombre y cuáles los apellidos`);
  if (f.venceAmbigua) f.avisos.push('La fecha de vencimiento del pasaporte es ambigua; captúrala después en el expediente');
  if (f.noches === 0) f.avisos.push('La reservación tiene 0 noches (habitación compartida o cambio)');
  if (grupo.llegada && grupo.salida && f.llegada && f.salida) {
    const antes = new Date(`${grupo.llegada}T00:00:00Z`).getTime() - 86400000;
    const despues = new Date(`${grupo.salida}T00:00:00Z`).getTime() + 86400000;
    const ll = new Date(`${f.llegada}T00:00:00Z`).getTime();
    const sa = new Date(`${f.salida}T00:00:00Z`).getTime();
    if (sa < antes || ll > despues) f.avisos.push('Su estancia no coincide con las fechas del grupo');
  }
  return f;
}
