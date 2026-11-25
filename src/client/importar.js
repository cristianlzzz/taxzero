// Pantalla "Dar de alta desde la rooming list" (PC). Lee el archivo en el navegador, muestra la
// vista previa con duplicados y filas con problemas, y da de alta solo lo que la persona confirma.
// El alta manual de un huésped sigue existiendo aparte.
import { PAISES, PAISES_FREC } from './catalogos.js';
import { api, dateTxt, esc, folioGrupo } from './util.js';
import { comparable, leerCSV, leerOpera, leerOperaXML, leerTabla, nombrePais, renglones, revisar, revisarProblemas } from './rooming.js';
import { toast } from './main.js';

const MAX_MB = 20;
let imp = nuevo();
let repintar = () => {};
let recargarDatos = async () => {};
let pendiente = null; // archivo que se acaba de subir como documento del evento

function nuevo(grupoId = null) {
  return { grupoId, archivo: null, base: [], filas: [], total: null, bloque: '', acompanantes: false, leyendo: false, error: '', filtro: 'todas', editNac: -1, confirmar: false, enviando: false, resultado: null };
}

export function configurar({ pintar, recargar }) {
  repintar = pintar;
  recargarDatos = recargar;
}

// Desde "Documentos del evento": al subir una rooming list se puede pasar directo a la vista previa.
export function prepararArchivo(file) {
  pendiente = file;
}

export function alEntrar(datos) {
  if (imp.grupoId !== datos.grupo.id || imp.resultado) imp = nuevo(datos.grupo.id);
  if (pendiente) {
    const f = pendiente;
    pendiente = null;
    leerArchivo(f, datos);
  }
}

// ------------------------------------------------------------------ lectura
async function textoPDF(buf) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.mjs';
  const tarea = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true });
  const doc = await tarea.promise;
  const lineas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    lineas.push(...renglones(tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))));
  }
  tarea.destroy();
  return lineas;
}

async function leerArchivo(file, datos) {
  imp = { ...nuevo(datos.grupo.id), archivo: { nombre: file.name, bytes: file.size }, leyendo: true };
  repintar();
  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`El archivo debe pesar menos de ${MAX_MB} MB.`);
    const buf = await file.arrayBuffer();
    let r;
    if (ext === 'pdf') {
      const lineas = await textoPDF(buf);
      if (!lineas.length) throw new Error('Este PDF no tiene texto que se pueda leer (parece escaneado). Exporta la rooming list desde Opera en PDF o en Excel.');
      r = leerOpera(lineas);
      if (!r.filas.length) {
        // Algunos PDF traen una tabla con títulos en lugar del formato de Opera.
        const t = leerTabla(lineas.map((l) => l.split(/\s{2,}|\t/)));
        if (t.filas.length) r = t;
      }
      if (!r.filas.length) throw new Error('No encontramos huéspedes en este PDF. Debe ser el reporte "Group Rooming List" de Opera.');
    } else if (ext === 'xml') {
      r = leerOperaXML(new TextDecoder().decode(buf));
      if (!r) throw new Error('Este XML no es la rooming list de Opera. Descárgalo desde el reporte "Group Rooming List" (grprmlist).');
      if (!r.filas.length) throw new Error('El XML no tiene reservaciones.');
    } else if (ext === 'xlsx') {
      const { leerXlsx } = await import('./lector-xlsx.js');
      r = leerTabla(await leerXlsx(buf));
    } else if (ext === 'csv' || ext === 'txt') {
      r = leerTabla(leerCSV(new TextDecoder().decode(buf)));
    } else if (ext === 'xls') {
      throw new Error('Este Excel es de formato antiguo (.xls). Ábrelo en Excel y guárdalo como .xlsx, o exporta la rooming list de Opera en PDF.');
    } else {
      throw new Error('Usa la rooming list de Opera en XML o PDF, o un Excel (.xlsx) o CSV.');
    }
    if (r.sinTitulos) throw new Error('No encontramos los títulos de las columnas. El Excel debe tener una columna "Nombre" y otra "Apellido" (o una sola columna "Name" como en Opera).');
    if (!r.filas.length) throw new Error('El archivo no tiene huéspedes.');
    if (r.filas.length > 1500) throw new Error('El archivo trae más de 1,500 filas. Divídelo en partes.');
    imp.base = r.filas;
    imp.total = r.total;
    imp.bloque = r.bloque;
    imp.tieneAcomp = r.filas.some((f) => f.acompanantes?.length);
    imp.esOpera = ext === 'pdf' || ext === 'xml';
    reconstruir(datos);
  } catch (e) {
    imp.error = e.message || 'No se pudo leer el archivo.';
  }
  imp.leyendo = false;
  repintar();
}

function reconstruir(datos) {
  imp.filas = revisar(imp.base, datos.expedientes || [], datos.grupo, { acompanantes: imp.acompanantes });
  imp.editNac = -1;
  imp.confirmar = false;
}

// ------------------------------------------------------------------ pantalla
const lista = (f) => f.incluir && !f.problemas.length;
const FILTROS = [
  ['todas', 'Todas', () => true],
  ['listas', 'Listas para alta', lista],
  ['problemas', 'Con problemas', (f) => f.problemas.length > 0],
  ['repetidas', 'Repetidas o ya en el grupo', (f) => !!f.dup],
  ['fuera', 'Canceladas o no show', (f) => !!f.fuera],
  ['excluidas', 'No incluidas', (f) => !f.incluir],
];

function opcionesPais(sel = '') {
  const frec = PAISES_FREC.map((c) => PAISES.find((p) => p[1] === c)).filter(Boolean);
  const op = (p) => `<option value="${p[1]}" ${p[1] === sel ? 'selected' : ''}>${esc(p[0])}</option>`;
  return `<option value="">Elige un país</option><optgroup label="Más frecuentes">${frec.map(op).join('')}</optgroup><optgroup label="Todos los países">${PAISES.map(op).join('')}</optgroup>`;
}

function estadoFila(f) {
  const partes = [];
  if (lista(f)) partes.push('<span class="pill mine"><i></i>Lista para alta</span>');
  else if (f.incluir && f.problemas.length) partes.push('<span class="pill warn"><i></i>Corrige para dar de alta</span>');
  else partes.push('<span class="pill na"><i></i>No se dará de alta</span>');
  for (const p of f.problemas) partes.push(`<span class="sub imp-prob">${esc(p)}</span>`);
  if (f.dup) partes.push(`<span class="sub">${esc(f.dup)}${f.incluir ? '. La incluiste de todos modos.' : ''}</span>`);
  if (f.fuera) partes.push(`<span class="sub">${esc(f.fuera)}</span>`);
  for (const a of f.avisos) partes.push(`<span class="sub">${esc(a)}</span>`);
  return partes.join('');
}

function celdaNac(f, i) {
  if (imp.editNac === i) return `<select class="imp-nac" data-imp-nac="${i}" aria-label="Nacionalidad de la fila ${f.n}">${opcionesPais(f.nac)}</select>`;
  return `<button type="button" class="linkbtn ${f.nac ? '' : 'imp-falta'}" data-a="imp-nac" data-i="${i}">${f.nac ? esc(nombrePais(f.nac)) : 'Elegir'}</button>`;
}

function filaHTML(f, i) {
  const est = f.llegada || f.salida ? `<span class="nw">${dateTxt(f.llegada)}</span><span class="sub nw">al ${dateTxt(f.salida)}</span>` : '<span class="muted">·</span>';
  return `<tr data-fila="${i}" class="${lista(f) ? '' : 'imp-off'}">
    <td class="imp-chk"><input type="checkbox" data-imp-inc="${i}" ${f.incluir ? 'checked' : ''} aria-label="Incluir la fila ${f.n}"></td>
    <td class="num muted">${f.n}</td>
    <td><input type="text" class="imp-in" data-imp-campo="nombre" data-i="${i}" value="${esc(f.nombre)}" maxlength="120" aria-label="Nombre(s) de la fila ${f.n}"></td>
    <td><input type="text" class="imp-in" data-imp-campo="apellidos" data-i="${i}" value="${esc(f.apellidos)}" maxlength="120" aria-label="Apellidos de la fila ${f.n}">
      ${f.original && comparable(f.original) !== comparable(`${f.apellidos} ${f.nombre}`) ? `<span class="sub">En el archivo: ${esc(f.original)}</span>` : ''}</td>
    <td>${celdaNac(f, i)}${f.pasaporte ? `<span class="sub mono">${esc(f.pasaporte)}</span>` : ''}</td>
    <td class="num">${est}</td>
    <td class="imp-rev">${estadoFila(f)}</td></tr>`;
}

function resumen() {
  const n = imp.filas.filter(lista).length;
  const bloq = imp.filas.filter((f) => f.incluir && f.problemas.length).length;
  return { n, bloq };
}

function pie(g) {
  const { n, bloq } = resumen();
  if (imp.confirmar) {
    return `<div class="imp-pie card stack gap-sm" id="imp-pie"><p><b>¿Dar de alta ${n} ${n === 1 ? 'huésped' : 'huéspedes'} en ${esc(g.nombre)}?</b></p>
      <p class="note">Los huéspedes no se borran. Si alguno no corresponde, Grupos lo marca como No aplica con su motivo. Cada alta queda en la bitácora con el nombre del archivo.</p>
      <p class="err" id="imp-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="imp-volver" ${imp.enviando ? 'disabled' : ''}>Volver a la vista previa</button>
      <button type="button" class="btn primary" data-a="imp-enviar" ${imp.enviando ? 'disabled' : ''}>${imp.enviando ? 'Dando de alta…' : `Sí, dar de alta ${n}`}</button></div></div>`;
  }
  return `<div class="imp-pie card row space-between" id="imp-pie"><div><b class="num">${n}</b> ${n === 1 ? 'huésped listo' : 'huéspedes listos'} para dar de alta.
      ${bloq ? `<span class="note">${bloq} ${bloq === 1 ? 'fila seleccionada tiene' : 'filas seleccionadas tienen'} problemas y no entrará${bloq === 1 ? '' : 'n'} hasta que la${bloq === 1 ? '' : 's'} corrijas.</span>` : ''}</div>
    <div class="row"><button type="button" class="btn" data-a="imp-otro">Elegir otro archivo</button>
    <button type="button" class="btn primary" data-a="imp-confirmar" ${n ? '' : 'disabled'}>Dar de alta ${n} ${n === 1 ? 'huésped' : 'huéspedes'}</button></div></div>`;
}

function selector(g) {
  return `<div class="card flat stack">
    <p>Sube la rooming list del grupo tal como sale de Opera (reporte <i>Group Rooming List</i>). <b>El XML es el más exacto</b>; también sirven el PDF, o un Excel (.xlsx) o CSV con columnas de nombre y apellido.</p>
    <ul class="imp-lista note">
      <li>Antes de dar de alta verás una vista previa. Ahí eliges la nacionalidad, corriges nombres y decides qué filas entran.</li>
      <li>Las reservaciones repetidas de una misma persona y los huéspedes que ya están en el grupo se marcan y no se incluyen.</li>
      <li>No se guardan número de habitación ni número de reservación, aunque vengan en el archivo.</li>
    </ul>
    <div><label class="btn primary" for="imp-file">Elegir archivo</label><input id="imp-file" class="file-hidden" type="file" accept=".xml,.pdf,.xlsx,.csv" data-imp-file></div>
    ${imp.error ? `<p class="err">${esc(imp.error)}</p>` : ''}
    <p class="note">También puedes seguir dando de alta huéspedes uno por uno desde la página del grupo.</p></div>`;
}

function vistaPrevia(g) {
  const conteo = Object.fromEntries(FILTROS.map(([k, , fn]) => [k, imp.filas.filter(fn).length]));
  const fn = (FILTROS.find((x) => x[0] === imp.filtro) || FILTROS[0])[2];
  const filas = imp.filas.map((f, i) => (fn(f) ? filaHTML(f, i) : '')).join('');
  const sinNac = imp.filas.filter((f) => !f.nac).length;
  const leidas = imp.base.length;
  const cuadra = imp.total == null ? '' : imp.total === leidas
    ? `<span class="note">Coincide con el total del reporte (${imp.total}).</span>`
    : `<div class="notice">El reporte dice ${imp.total} reservaciones y se leyeron ${leidas}. Revisa que no falte nadie antes de confirmar.</div>`;
  return `<div class="card flat stack">
      <div class="row space-between"><div><p class="eyebrow">Archivo</p><h3>${esc(imp.archivo.nombre)}</h3></div><button type="button" class="btn sm" data-a="imp-otro">Elegir otro archivo</button></div>
      <p>${leidas} ${leidas === 1 ? 'fila leída' : 'filas leídas'}${imp.bloque ? ` del bloque <span class="mono">${esc(imp.bloque)}</span>` : ''}. ${cuadra}</p>
      <div class="imp-herr">
        ${sinNac ? `<div class="field"><label for="imp-nac-todos">Nacionalidad para las filas que no la tienen${sinNac ? ` (${sinNac})` : ''}</label>
          <div class="row nowrap"><select id="imp-nac-todos">${opcionesPais()}</select><button type="button" class="btn" data-a="imp-nac-todos" ${sinNac ? '' : 'disabled'}>Aplicar</button></div>
          <span class="note">${imp.esOpera ? 'La rooming list de Opera no trae nacionalidad. ' : ''}Elige la del grupo y cambia una por una las que sean distintas.</span></div>` : '<p class="note">Todas las filas traen nacionalidad. Puedes cambiarla una por una.</p>'}
        ${imp.tieneAcomp ? `<label class="toggle imp-acomp"><input type="checkbox" data-imp-acomp ${imp.acompanantes ? 'checked' : ''}><span>Incluir a los acompañantes como huéspedes
          <span class="note">${imp.esOpera ? 'Opera los lista bajo "Accompanying Names". ' : ''}Si los activas, revisa su nombre y apellidos.</span></span></label>` : ''}
      </div></div>
    <div class="seg" role="tablist" aria-label="Filtrar filas">${FILTROS.map(([k, l]) => (conteo[k] || k === 'todas' ? `<button class="tab" role="tab" data-a="imp-filtro" data-k="${k}" aria-selected="${imp.filtro === k}">${l} (${conteo[k]})</button>` : '')).join('')}</div>
    <div class="tablewrap"><table class="imp-tabla"><thead><tr><th><span class="sr">Incluir</span></th><th>#</th><th>Nombre(s)</th><th>Apellidos</th><th>Nacionalidad</th><th>Estancia</th><th>Revisión</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="7" class="empty">Ninguna fila con este filtro.</td></tr>'}</tbody></table></div>
    ${pie(g)}`;
}

function resultadoHTML(g) {
  const r = imp.resultado;
  return `<div class="card flat stack"><h2>${r.altas} ${r.altas === 1 ? 'huésped dado de alta' : 'huéspedes dados de alta'}</h2>
    <p>Quedaron en ${esc(g.nombre)} como <b>Pendiente de captura</b>. Front Desk ya puede generar su QR cuando lleguen.</p>
    ${r.omitidas?.length ? `<div class="notice">${r.omitidas.length} ${r.omitidas.length === 1 ? 'fila no entró porque ya estaba' : 'filas no entraron porque ya estaban'} en el grupo: ${r.omitidas.slice(0, 20).map((o) => esc(o.nombre)).join(', ')}${r.omitidas.length > 20 ? '…' : ''}</div>` : ''}
    <p class="note">La importación quedó en la bitácora del grupo con el nombre del archivo.</p>
    <div class="row"><a class="btn primary" href="#/grupos/${g.id}">Ir al grupo</a></div></div>`;
}

export function pantallaImportar(datos, crumbs) {
  const g = datos.grupo;
  let cuerpo;
  if (datos.cancelacion) cuerpo = '<div class="notice cancelado">Este grupo está cancelado. Para dar de alta huéspedes, Grupos debe reactivarlo.</div>';
  else if (imp.resultado) cuerpo = resultadoHTML(g);
  else if (imp.leyendo) cuerpo = '<div class="loading"><span class="spinner"></span>Leyendo el archivo…</div>';
  else if (!imp.filas.length) cuerpo = selector(g);
  else cuerpo = vistaPrevia(g);
  return `${crumbs([{ t: 'Grupos', href: '#/' }, { t: g.nombre, href: `#/grupos/${g.id}` }, { t: 'Rooming list' }])}
    <section class="page-head"><div><p class="eyebrow mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</p><h1>Dar de alta desde la rooming list</h1>
      <p class="lead">${(datos.expedientes || []).length} ${(datos.expedientes || []).length === 1 ? 'huésped ya dado de alta' : 'huéspedes ya dados de alta'} en este grupo. Estancia del ${dateTxt(g.llegada)} al ${dateTxt(g.salida)}.</p></div></section>
    <div class="stack">${cuerpo}</div>`;
}

// ------------------------------------------------------------------ acciones
function refrescarFila(i) {
  const tr = document.querySelector(`tr[data-fila="${i}"]`);
  if (!tr) return;
  const f = imp.filas[i];
  tr.classList.toggle('imp-off', !lista(f));
  tr.querySelector('.imp-rev').innerHTML = estadoFila(f);
  tr.querySelector('[data-imp-inc]').checked = f.incluir;
  refrescarPie();
}
function refrescarPie() {
  const el = document.getElementById('imp-pie');
  if (el) el.outerHTML = pie({ nombre: imp.nombreGrupo || '' });
}

export function manejarClic(d, datos) {
  imp.nombreGrupo = datos.grupo.nombre;
  switch (d.a) {
    case 'imp-otro':
      imp = nuevo(datos.grupo.id);
      repintar();
      setTimeout(() => document.getElementById('imp-file')?.click(), 0);
      return true;
    case 'imp-filtro':
      imp.filtro = d.k;
      repintar();
      return true;
    case 'imp-nac':
      imp.editNac = +d.i;
      repintar();
      document.querySelector(`[data-imp-nac="${d.i}"]`)?.focus();
      return true;
    case 'imp-nac-todos': {
      const sel = document.getElementById('imp-nac-todos');
      if (!sel?.value) {
        toast('Elige primero la nacionalidad.');
        return true;
      }
      let n = 0;
      for (const f of imp.filas) if (!f.nac) {
        f.nac = sel.value;
        revisarProblemas(f, datos.grupo);
        n++;
      }
      toast(`Nacionalidad aplicada a ${n} ${n === 1 ? 'fila' : 'filas'}.`);
      repintar();
      return true;
    }
    case 'imp-confirmar':
      imp.confirmar = true;
      refrescarPie();
      return true;
    case 'imp-volver':
      imp.confirmar = false;
      refrescarPie();
      return true;
    case 'imp-enviar':
      enviar(datos);
      return true;
    default:
      return false;
  }
}

export function manejarCambio(t, datos) {
  imp.nombreGrupo = datos.grupo.nombre;
  if (t.matches('[data-imp-file]')) {
    const file = t.files?.[0];
    if (file) leerArchivo(file, datos);
    return true;
  }
  if (t.matches('[data-imp-acomp]')) {
    imp.acompanantes = t.checked;
    // Se conservan las nacionalidades ya elegidas para las filas del archivo.
    const antes = new Map(imp.filas.filter((f) => f.origen === 'archivo').map((f) => [f.ref, f.nac]));
    reconstruir(datos);
    for (const f of imp.filas) if (!f.nac && antes.get(f.ref)) {
      f.nac = antes.get(f.ref);
      revisarProblemas(f, datos.grupo);
    }
    repintar();
    return true;
  }
  if (t.matches('[data-imp-inc]')) {
    const f = imp.filas[+t.dataset.impInc];
    f.incluir = t.checked;
    f.dupOk = t.checked && !!f.dup;
    refrescarFila(+t.dataset.impInc);
    return true;
  }
  if (t.matches('[data-imp-nac]')) {
    const i = +t.dataset.impNac;
    imp.filas[i].nac = t.value;
    revisarProblemas(imp.filas[i], datos.grupo);
    imp.editNac = -1;
    repintar();
    return true;
  }
  if (t.matches('[data-imp-campo]')) {
    const i = +t.dataset.i;
    imp.filas[i][t.dataset.impCampo] = t.value.replace(/\s+/g, ' ').trim();
    revisarProblemas(imp.filas[i], datos.grupo);
    refrescarFila(i);
    return true;
  }
  return false;
}

async function enviar(datos) {
  const filas = imp.filas.filter(lista).map((f) => ({
    fila: f.n, nombre: f.nombre, apellidos: f.apellidos, nacionalidad_codigo: f.nac, nacionalidad: nombrePais(f.nac),
    pasaporte: f.pasaporte || '', pasaporte_vence: f.vence || '', duplicado_ok: !!f.dup,
  }));
  if (!filas.length) return;
  imp.enviando = true;
  refrescarPie();
  try {
    imp.resultado = await api('POST', `/api/grupos/${datos.grupo.id}/importar`, { archivo: imp.archivo.nombre, filas });
    imp.enviando = false;
    toast(`${imp.resultado.altas} ${imp.resultado.altas === 1 ? 'huésped dado de alta' : 'huéspedes dados de alta'}.`);
    await recargarDatos(false);
    window.scrollTo(0, 0);
  } catch (e) {
    imp.enviando = false;
    refrescarPie();
    const err = document.getElementById('imp-err');
    if (err) {
      err.hidden = false;
      err.textContent = e.message;
    } else toast(e.message);
  }
}
