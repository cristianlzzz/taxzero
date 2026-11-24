// Prueba de punta a punta del flujo de la etapa 1 contra un servidor local.
// Uso: BASE=http://127.0.0.1:8787 node tests/e2e.mjs  (requiere las claves de prueba en env)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Playwright viene instalado en el equipo de pruebas, no como dependencia del proyecto.
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'tests/salida';
const C = {
  grupos: ['grupos.taxzero@example.com', process.env.CLAVE_GRUPOS],
  frontdesk: ['frontdesk.taxzero@example.com', process.env.CLAVE_FRONTDESK],
  ipad: ['ipad1.taxzero@example.com', process.env.CLAVE_IPAD],
  credito: ['credito.taxzero@example.com', process.env.CLAVE_CREDITO],
  impuestos: ['impuestos.taxzero@example.com', process.env.CLAVE_IMPUESTOS],
  admin: ['admin.taxzero@example.com', process.env.CLAVE_ADMIN],
};
mkdirSync(OUT, { recursive: true });

let fallos = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fallos++;
};

const browser = await chromium.launch();

// Fotos de prueba: documentos sintéticos con mucho texto, uno nítido y uno borroso.
async function fotos() {
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const res = {};
  for (const [tipo, titulo] of [['pasaporte', 'PASAPORTE · PASSPORT'], ['regcard', 'REGISTRATION CARD'], ['pago', 'COMPROBANTE DE PAGO **** 4821'], ['fmm', 'FORMA MIGRATORIA MÚLTIPLE']]) {
    for (const borrosa of [false, true]) {
      await p.setContent(`<body style="margin:0;background:#8a8580;display:grid;place-items:center;height:100vh">
        <div style="width:1100px;height:760px;background:#f4efe4;border-radius:14px;padding:40px;font:22px Arial;color:#222;${borrosa ? 'filter:blur(7px)' : ''}">
          <h1 style="margin:0 0 20px;letter-spacing:3px">${titulo}</h1>
          ${Array.from({ length: 14 }, (_, i) => `<div>Campo ${i + 1}: EMILY CARTER · USA · P${123456 + i} · 14 NOV 1988</div>`).join('')}
          <div style="font:26px monospace;margin-top:20px">P&lt;USACARTER&lt;&lt;EMILY&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</div>
        </div></body>`);
      const f = `${OUT}/foto-${tipo}${borrosa ? '-borrosa' : ''}.jpg`;
      await p.screenshot({ path: f, type: 'jpeg', quality: 90 });
      res[tipo + (borrosa ? '-b' : '')] = f;
    }
  }
  await p.close();
  return res;
}

async function sesion(rol, opts = {}, cred = C[rol]) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok(false, `error de página (${rol}): ${e.message}`));
  await page.goto(BASE);
  await page.fill('#l-email', cred[0]);
  await page.fill('#l-clave', cred[1]);
  await page.click('button[type=submit]');
  // Al primer ingreso (o si cambió el aviso) se pide aceptar el aviso de privacidad.
  await page.waitForSelector('[data-form="aviso"], header.top, .station, #l-err:not([hidden])', { timeout: 15000 });
  if (await page.isVisible('[data-form="aviso"]')) {
    ok(await page.isDisabled('#av-btn'), `Aviso de privacidad: no deja entrar sin marcar la casilla (${rol})`);
    const r = await page.evaluate(async () => (await fetch('/api/grupos')).status);
    ok(r === 428, `Sin aceptar el aviso el servidor no entrega datos (${r})`);
    if (rol === 'nuevo') await page.screenshot({ path: `${OUT}/00-aviso-personal.png` });
    await page.check('#av-ok');
    await page.click('#av-btn');
    await page.waitForSelector('header.top, .station');
  }
  return { ctx, page };
}

async function aceptarAvisoHuesped(page) {
  await page.waitForSelector('#aviso-huesped');
  await page.click('button:has-text("Acepto / I accept")');
}

const F = await fotos();
// Documentos del evento de prueba: un PDF mínimo y un "Excel" (zip) para el rooming list.
writeFileSync(`${OUT}/contrato.pdf`, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n' + ' '.repeat(200));
writeFileSync(`${OUT}/rooming.xlsx`, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(300, 1)]));
const sufijo = Date.now().toString().slice(-5);
// Fechas en hora de Cancún: el alta no acepta llegadas anteriores a hoy.
const diaCancun = (dias = 0) => new Date(Date.now() + dias * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Cancun' });
const HOY = diaCancun();
const SALIDA = diaCancun(4);
const nombreGrupo = `Convención de prueba ${sufijo}`;

// ---------------------------------------------------------------- 1. Grupos da de alta el grupo
{
  const { ctx, page } = await sesion('grupos');
  await page.waitForSelector('text=Expedientes por');
  await page.screenshot({ path: `${OUT}/01-grupos-inicio.png` });
  await page.click('text=Dar de alta un grupo');
  await page.fill('#a-nombre', nombreGrupo);
  await page.fill('#a-empresa', 'Northwind Medical Inc.');
  await page.fill('#a-contacto', 'Rachel Simmons, event manager');
  await page.fill('#a-llegada', diaCancun(-1));
  await page.fill('#a-salida', SALIDA);
  await page.click('button:has-text("Crear grupo")');
  ok(await page.isVisible('#a-err:has-text("anterior a hoy")'), 'El alta no acepta una llegada anterior a hoy');
  const pasada = await page.evaluate(async (d) => (await fetch('/api/grupos', { method: 'POST', headers: { 'x-taxzero': '1', 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'Grupo con fecha pasada', empresa: 'X', llegada: d, salida: d }) })).status, diaCancun(-1));
  ok(pasada === 400, `El servidor también rechaza la llegada anterior a hoy (${pasada})`);
  await page.fill('#a-llegada', HOY);
  await page.fill('#a-est', '450');
  await page.fill('#a-codigo', `GRP-${sufijo}`);
  await page.click('button:has-text("Crear grupo")');
  await page.waitForTimeout(500);
  ok(await page.isVisible('h1:has-text("Dar de alta un")'), 'El alta exige tipo de evento y organizador');
  await page.selectOption('#a-tipo', 'convencion');
  await page.fill('#a-org', 'Northwind Medical Association');
  await page.selectOption('#a-pais', 'USA');
  await page.fill('#a-idf', 'EIN 12-3456789');
  await page.screenshot({ path: `${OUT}/02-alta-grupo.png`, fullPage: true });
  await page.click('button:has-text("Crear grupo")');
  await page.waitForSelector(`h1:has-text("${nombreGrupo}")`);
  ok(true, 'Grupos creó el grupo');
  await page.click('button[data-a=editgrupo]');
  await page.fill('#eg-empresa', 'Northwind Medical Group');
  await page.click('.modal button[type=submit]');
  ok(await page.isVisible('#eg-err:has-text("motivo")'), 'Editar el grupo exige motivo');
  await page.fill('#eg-motivo', 'Error de captura en la empresa');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('dd:has-text("Northwind Medical Group")');
  ok(await page.isVisible('text=Cambió la empresa: «Northwind Medical Inc.» → «Northwind Medical Group»'), 'La edición queda en la bitácora con el valor anterior y el nuevo');
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('.tablero-bar');
  await page.click('[data-a=etapa][data-k=casa]');
  ok(await page.isVisible(`.gcard:has-text("${nombreGrupo}")`), 'El grupo de hoy aparece en En casa');
  await page.selectOption('#g-anio', HOY.slice(0, 4));
  ok(await page.isVisible(`.gcard:has-text("${nombreGrupo}")`), 'El filtro por año muestra el grupo de este año');
  ok(await page.isVisible('footer.pie:has-text("Cristian Lázaro")'), 'El pie de página muestra el aviso de copyright');
  await page.selectOption('#g-anio', '');
  await page.goBack();
  await page.waitForSelector(`h1:has-text("${nombreGrupo}")`);
  ok(await page.isVisible('dd:has-text("Convención")'), 'El grupo muestra el tipo de evento');
  await page.setInputFiles('#up-contrato', `${OUT}/contrato.pdf`);
  await page.waitForSelector('.docrow.ok:has-text("Contrato del evento") >> text=contrato.pdf');
  ok(true, 'Grupos subió el contrato en PDF');
  await page.setInputFiles('#up-rooming', `${OUT}/rooming.xlsx`);
  await page.waitForSelector('.docrow.ok:has-text("Rooming list") >> text=rooming.xlsx');
  ok(true, 'Grupos subió el rooming list en Excel');
  await page.setInputFiles('#up-agenda', `${OUT}/rooming.xlsx`);
  await page.waitForSelector('#up-err:has-text("PDF")');
  ok(true, 'Un Excel fuera del rooming list se rechaza');
  const href = await page.getAttribute('.docrow:has-text("Contrato del evento") a', 'href');
  const st = await page.evaluate(async (u) => { const r = await fetch(u); return `${r.status} ${r.headers.get('content-type')}`; }, href);
  ok(st === '200 application/pdf', `El contrato se puede abrir (${st})`);
  await page.click('button[data-a=evento]');
  await page.selectOption('#ev-tipo', 'congreso');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('dd:has-text("Congreso")');
  ok(await page.isVisible('text=Registró datos del evento: Congreso'), 'Actualizar el evento queda en la bitácora del grupo');
  await page.screenshot({ path: `${OUT}/02b-expediente-evento.png`, fullPage: true });
  ok(!(await page.isVisible('text=Dar de alta un huésped')), 'Grupos no ve el alta de huéspedes');
  await ctx.close();
}

// ---------------------------------------------------------------- 2. Front Desk da de alta huéspedes y genera QR
let codigo, codigo2;
{
  const { ctx, page } = await sesion('frontdesk');
  await page.waitForSelector('text=dar de alta');
  ok(!(await page.isVisible('text=Dar de alta un grupo')), 'Front Desk no ve el alta de grupos');
  ok(!(await page.isVisible('a.tab:has-text("Avance")')), 'Front Desk no ve la pestaña Avance');
  const camposFD = await page.evaluate(async () => Object.keys((await (await fetch('/api/grupos')).json()).grupos[0] || {}));
  ok(!camposFD.includes('detenidos'), 'El servidor no entrega a Front Desk los datos del Avance');
  const salidasFD = await page.evaluate(async () => (await (await fetch('/api/grupos')).json()).grupos.map((g) => g.salida));
  ok(salidasFD.every((d) => d >= HOY), `Front Desk solo recibe grupos en casa o por llegar (${salidasFD.length})`);
  ok(!(await page.isVisible('[data-a=etapa][data-k=salieron]')), 'Front Desk no tiene la pestaña Ya salieron');
  await page.goto(`${BASE}/#/avance`);
  await page.waitForSelector('text=Tu área no tiene acceso');
  ok(true, 'Front Desk no puede abrir el Avance escribiendo la dirección');
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('.tablero-bar');
  await page.click(`a.gcard:has-text("${nombreGrupo}")`);
  await page.click('text=Dar de alta un huésped');
  await page.fill('#h-nom', 'Emily');
  await page.fill('#h-ape', 'Carter');
  await page.selectOption('#h-nac', 'USA');
  await page.fill('#h-pas', 'p 1234 5678');
  await page.fill('#h-vence', '2030-05-01');
  await page.screenshot({ path: `${OUT}/03-alta-huesped.png` });
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.qrbox');
  codigo = (await page.textContent('.qrbox .code')).trim();
  ok(/^TZ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo), `QR generado: ${codigo}`);
  await page.screenshot({ path: `${OUT}/04-qr.png` });
  await page.click(".modal [data-a=cerrar-modal]");
  await page.waitForSelector('text=Ver QR activo');

  // Huésped mexicano: aviso de que no aplica
  await page.click('text=Dar de alta un huésped');
  await page.fill('#h-nom', 'Carlos');
  await page.fill('#h-ape', 'Méndez');
  await page.selectOption('#h-nac', 'MEX');
  ok(await page.isVisible('#h-nac-mx'), 'Al elegir México avisa que no aplica');
  await page.uncheck('#h-qr');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('td:has-text("Méndez")');

  // Segundo huésped para la prueba de captura incompleta
  await page.click('text=Dar de alta un huésped');
  await page.fill('#h-nom', 'Lukas');
  await page.fill('#h-ape', 'Becker');
  await page.selectOption('#h-nac', 'DEU');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.qrbox');
  codigo2 = (await page.textContent('.qrbox .code')).trim();
  await page.click(".modal [data-a=cerrar-modal]");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/05-grupo-frontdesk.png`, fullPage: true });
  await ctx.close();
}

// ---------------------------------------------------------------- 3. iPad captura
{
  const { ctx, page } = await sesion('ipad', { ...devices['iPad (gen 7) landscape'], permissions: [] });
  await page.waitForSelector('text=Escanea el QR del huésped');
  await page.screenshot({ path: `${OUT}/06-ipad-escanear.png` });
  await page.fill('#cod', codigo.toLowerCase().replace(/-/g, ' '));
  await page.click('button:has-text("Continuar")');
  await page.waitForSelector('#aviso-huesped');
  ok(await page.isHidden('#foto'), 'El iPad muestra el aviso de privacidad al huésped antes de las fotos');
  await page.screenshot({ path: `${OUT}/06b-ipad-aviso.png` });
  // Sin aceptar, el servidor no guarda fotos.
  const sinAviso = await page.evaluate(async ({ cod }) => {
    const r = await fetch(`/api/captura/${cod}/foto?exp=00000000-0000-0000-0000-000000000000&tipo=pasaporte`, {
      method: 'POST', headers: { 'x-taxzero': '1', 'content-type': 'image/jpeg' }, body: new Uint8Array([0xff, 0xd8, 0xff, ...new Array(2000).fill(1)]),
    });
    return r.status;
  }, { cod: codigo });
  ok(sinAviso >= 400, `Sin aceptar el aviso no se guarda ninguna foto (${sinAviso})`);
  await aceptarAvisoHuesped(page);
  await page.waitForSelector('text=Paso 1 de 5');
  ok(await page.isVisible('text=Paso 1 de 5'), 'La captura pide 4 documentos y el gafete opcional');

  // Pasaporte: primero una foto borrosa
  await page.setInputFiles('#foto', F['pasaporte-b']);
  await page.waitForSelector('text=La foto parece borrosa');
  ok(true, 'Detecta foto borrosa');
  await page.screenshot({ path: `${OUT}/07-ipad-borrosa.png` });
  await page.setInputFiles('#foto', F.pasaporte);
  await page.waitForSelector('button:has-text("Usar esta foto")');
  await page.screenshot({ path: `${OUT}/08-ipad-preview.png` });
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Paso 2 de 5');
  for (const [t, paso] of [['regcard', 3], ['pago', 4]]) {
    await page.setInputFiles('#foto', F[t]);
    await page.click('button:has-text("Usar esta foto")');
    await page.waitForSelector(`text=Paso ${paso} de 5`);
  }
  await page.click('button[data-k="sello"]');
  await page.setInputFiles('#foto', F.fmm);
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Paso 5 de 5: Gafete o constancia (opcional)');
  ok(await page.isVisible('button:has-text("Aún no lo tiene")'), 'El gafete se puede saltar');
  await page.screenshot({ path: `${OUT}/08b-ipad-gafete.png` });
  await page.setInputFiles('#foto', F.pasaporte);
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Revisión antes de enviar');
  await page.screenshot({ path: `${OUT}/09-ipad-resumen.png` });
  // Repetir una foto desde el resumen crea una versión nueva
  await page.click('.sum:nth-child(2) button');
  await page.setInputFiles('#foto', F.regcard);
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Revisión antes de enviar');
  await page.click('button:has-text("Enviar a Grupos")');
  await page.waitForSelector('text=Expediente enviado a Grupos');
  ok(true, 'Captura completa enviada a Grupos');
  await page.screenshot({ path: `${OUT}/10-ipad-listo.png` });

  // El mismo código no sirve dos veces
  await page.click('text=Escanear al siguiente huésped');
  await page.fill('#cod', codigo);
  await page.click('button:has-text("Continuar")');
  await page.waitForSelector('text=Este código ya se usó');
  ok(true, 'Un código usado se rechaza');
  await page.click('text=Escanear otro código');

  // Segundo huésped: no trae comprobante ni forma migratoria
  await page.fill('#cod', codigo2);
  await page.click('button:has-text("Continuar")');
  await page.waitForSelector('h1:has-text("Lukas Becker")');
  await aceptarAvisoHuesped(page);
  await page.setInputFiles('#foto', F.pasaporte);
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Paso 2 de 5');
  await page.setInputFiles('#foto', F.regcard);
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Paso 3 de 5');
  await page.click('text=El huésped no lo trae');
  await page.waitForSelector('text=Paso 4 de 5');
  await page.click('text=El huésped no lo trae');
  await page.waitForSelector('text=Paso 5 de 5');
  await page.click('button:has-text("Aún no lo tiene")');
  await page.waitForSelector('text=Guardar como incompleta');
  ok(!(await page.isVisible('.notice:has-text("gafete")')), 'El gafete opcional no cuenta como faltante');
  await page.click('button:has-text("Guardar como incompleta")');
  await page.waitForSelector('text=Captura guardada como incompleta');
  ok(await page.isVisible('text=comprobante de pago, forma migratoria'), 'Incompleta indica lo que faltó');
  await ctx.close();
}

// ---------------------------------------------------------------- 4. Grupos ve el expediente con las fotos reales
{
  const { ctx, page } = await sesion('grupos');
  await page.click(`a.gcard:has-text("${nombreGrupo}")`);
  await page.waitForSelector('td:has-text("Carter")');
  await page.screenshot({ path: `${OUT}/11-grupo-grupos.png`, fullPage: true });
  await page.click('tr:has-text("Carter") >> text=Abrir');
  await page.waitForSelector('h1:has-text("Emily Carter")');
  await page.waitForFunction(() => [...document.querySelectorAll('.doc-b img')].every((i) => i.complete && i.naturalWidth > 0));
  const n = await page.$$eval('.doc-b img', (imgs) => imgs.filter((i) => i.naturalWidth > 0).length);
  ok(n === 5, `Grupos ve las 5 fotos del expediente (${n})`);
  ok(await page.isVisible('text=v2 · actual'), 'La registration card repetida muestra versiones');
  ok(await page.isVisible('text=Captura enviada a Grupos'), 'La bitácora registra el envío');
  await page.screenshot({ path: `${OUT}/12-expediente.png`, fullPage: true });
  await page.click('text=v1 · reemplazada');
  ok(await page.isVisible('text=Versión anterior'), 'Se puede ver la versión anterior');
  await page.click('.doc-b .view >> nth=0');
  await page.waitForSelector('.zoom-img');
  await page.screenshot({ path: `${OUT}/13-zoom.png` });
  await ctx.close();
}

// ---------------------------------------------------------------- 4b. Revisiones (etapa 2)
async function abrirExp(page, apellido) {
  await page.goto(BASE + '/#/');
  await page.click(`a.gcard:has-text("${nombreGrupo}")`);
  await page.click(`tr:has-text("${apellido}") >> text=Abrir`);
  await page.waitForSelector(`h1:has-text("${apellido}")`);
}
async function conMotivo(page, op, motivoIdx = 1, docs = []) {
  await page.click(`button[data-op="${op}"]`);
  await page.selectOption('#m-sel', { index: motivoIdx });
  for (const d of docs) await page.check(`input[name=rd][value=${d}]`);
  await page.click('#m-ok');
}
const marcarTodo = async (page) => {
  for (const c of await page.$$('[data-check]')) await c.check();
};

{
  // Grupos pide recapturar el pasaporte de Carter
  const { ctx, page } = await sesion('grupos');
  await abrirExp(page, 'Carter');
  ok(await page.isDisabled('#btn-go'), 'Aprobar empieza deshabilitado');
  await page.click('button[data-op="recaptura"]');
  ok(await page.isDisabled('#m-ok'), 'La recaptura exige motivo y documentos');
  await page.click('[data-a=cerrar-modal]');
  await conMotivo(page, 'recaptura', 1, ['pasaporte']);
  await page.waitForSelector(`h1:has-text("${nombreGrupo}")`);
  await page.waitForSelector('tr:has-text("Carter") >> text=Captura incompleta');
  ok(true, 'Tras pedir recaptura queda como Captura incompleta');
  await abrirExp(page, 'Becker');
  await conMotivo(page, 'no_aplica', 2);
  await page.waitForSelector('tr:has-text("Becker") >> text=No aplica');
  ok(true, 'Grupos marcó No aplica con motivo');
  await ctx.close();
}
{
  // Front Desk genera otro QR y el iPad solo pide el pasaporte
  const { ctx, page } = await sesion('frontdesk');
  await abrirExp(page, 'Carter');
  ok(await page.isVisible('text=Se pidió recapturar: pasaporte'), 'Front Desk ve qué hay que recapturar');
  await page.click('button[data-a=qr]');
  await page.waitForSelector('.qrbox');
  const codigo3 = (await page.textContent('.qrbox .code')).trim();
  await ctx.close();
  const ip = await sesion('ipad', devices['iPad (gen 7) landscape']);
  await ip.page.fill('#cod', codigo3);
  await ip.page.click('button:has-text("Continuar")');
  await aceptarAvisoHuesped(ip.page);
  await ip.page.waitForSelector('text=Paso 1 de 1: Pasaporte');
  ok(true, 'La recaptura solo pide el documento señalado');
  await ip.page.setInputFiles('#foto', F.pasaporte);
  await ip.page.click('button:has-text("Usar esta foto")');
  await ip.page.click('button:has-text("Enviar a Grupos")');
  await ip.page.waitForSelector('text=Expediente enviado a Grupos');
  await ip.ctx.close();
}
{
  const { ctx, page } = await sesion('grupos');
  await abrirExp(page, 'Carter');
  ok(await page.isVisible('text=Recaptura enviada a Grupos'), 'La bitácora registra la recaptura');
  await page.click('button[data-a=vence]');
  await page.fill('#ve-fecha', '2026-11-22');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('text=El pasaporte vence antes de la salida del grupo');
  ok(true, 'Avisa si el pasaporte vence antes de la salida del grupo');
  await page.click('button[data-a=vence]');
  await page.fill('#ve-fecha', '2031-01-15');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('dd:has-text("15 ene 2031")');
  ok(await page.isVisible('text=Cambió vencimiento del pasaporte (antes 22/11/2026): 15/01/2031'), 'Corregir el vencimiento queda en la bitácora con el dato anterior');
  ok(await page.isVisible('.doc:has-text("Pasaporte") >> text=v2 · actual'), 'El pasaporte tiene versión 2');
  await marcarTodo(page);
  await page.click('#btn-go');
  await page.waitForSelector('tr:has-text("Carter") >> text=En validación de Crédito');
  ok(true, 'Grupos aprobó y pasó a Crédito');
  await ctx.close();
}
{
  // Crédito: monto del grupo, devuelve a Grupos
  const { ctx, page } = await sesion('credito');
  await page.click(`a.gcard:has-text("${nombreGrupo}")`);
  await page.click('button[data-a=monto]');
  await page.fill('#mo-val', '18,450.00');
  await page.fill('#mo-nota', 'Autorizado por Cuentas por pagar, oficio CP-118');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.big-num:has-text("USD 18,450.00")');
  await page.click('button[data-a=monto]');
  await page.fill('#mo-val', '18,600.00');
  await page.fill('#mo-nota', 'Corrección autorizada por ADOF');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.big-num:has-text("USD 18,600.00")');
  ok(await page.isVisible('s:has-text("USD 18,450.00")'), 'El monto anterior sigue visible');
  // Documentos de Crédito y folio de la cuenta maestra.
  await page.click('button[data-a="folio-maestra"]');
  await page.fill('#fm-folio', 'cm-88123');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('dd >> text=CM-88123');
  ok(true, 'Crédito registró el folio de Opera de la cuenta maestra');
  await page.setInputFiles('#upc-autorizacion', `${OUT}/contrato.pdf`);
  await page.waitForSelector('.docrow.ok:has-text("Autorización de la devolución") >> text=contrato.pdf');
  ok(true, 'Crédito subió la autorización en PDF');
  await page.setInputFiles('#upc-autorizacion', `${OUT}/rooming.xlsx`);
  await page.waitForSelector('#upc-err:has-text("PDF")');
  ok(true, 'La autorización no se acepta en Excel');
  await page.setInputFiles('#upc-conciliacion', `${OUT}/rooming.xlsx`);
  await page.waitForSelector('.docrow.ok:has-text("Cálculo o conciliación") >> text=rooming.xlsx');
  ok(true, 'Crédito subió la conciliación en Excel');
  await page.click('button[data-a="doc-extra"]');
  await page.setInputFiles('#dx-file', `${OUT}/contrato.pdf`);
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('#dx-err:has-text("Describe")');
  await page.fill('#dx-desc', 'Nota de crédito por cargo duplicado');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.docrow:has-text("Documentos extraordinarios") >> text=Nota de crédito por cargo duplicado');
  ok(true, 'El documento extraordinario exige descripción y la muestra');
  ok(await page.isVisible('.log >> text=Subió documento extraordinario: contrato.pdf'), 'La subida queda en la bitácora del grupo');
  await page.screenshot({ path: `${OUT}/14-credito-grupo.png`, fullPage: true });
  await abrirExp(page, 'Carter');
  await page.waitForSelector('text=Validación de Crédito');
  await conMotivo(page, 'devolver_grupos', 2);
  await page.waitForSelector('tr:has-text("Carter") >> text=Devuelto a Grupos');
  ok(true, 'Crédito devolvió a Grupos con motivo');
  await ctx.close();
}
{
  const { ctx, page } = await sesion('grupos');
  await abrirExp(page, 'Carter');
  ok(await page.isVisible('.notice:has-text("Devuelto a Grupos")'), 'Grupos ve por qué se lo devolvieron');
  const docsCred = await page.evaluate(async (u) => (await (await fetch(`/api/grupos/${u}`)).json()).docs_credito.length, await page.locator('nav.crumbs a').nth(1).getAttribute('href').then((h) => h.split('/').pop()));
  ok(docsCred === 0, 'Grupos no recibe los documentos de Crédito');
  const id = page.url().split('/').pop();
  const r = await page.evaluate(async (id) => (await fetch(`/api/expedientes/${id}/accion`, { method: 'POST', headers: { 'x-taxzero': '1', 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'aprobar', estado: 'rev_grupos' }) })).status, id);
  ok(r === 409, `Una acción sobre un estado viejo se rechaza (${r})`);
  await marcarTodo(page);
  await page.click('#btn-go');
  await page.waitForSelector('tr:has-text("Carter") >> text=En validación de Crédito');
  await ctx.close();
}
{
  const { ctx, page } = await sesion('credito');
  await abrirExp(page, 'Carter');
  await page.screenshot({ path: `${OUT}/15-credito-expediente.png`, fullPage: true });
  await marcarTodo(page);
  await page.click('#btn-go');
  await page.waitForSelector('tr:has-text("Carter") >> text=En revisión de Impuestos');
  ok(true, 'Crédito validó y pasó a Impuestos');
  await ctx.close();
}
{
  const { ctx, page } = await sesion('impuestos');
  await abrirExp(page, 'Carter');
  const orden = await page.$$eval('.doc-h h3', (hs) => hs.map((h) => h.textContent.replace(/^\d/, '').split('·')[0].trim()));
  ok(orden.join('|') === 'Registration card|Pasaporte|Forma migratoria|Comprobante de pago|Gafete o constancia', `Impuestos ve el orden del archivo físico (${orden.join(', ')})`);
  await marcarTodo(page);
  await page.click('#btn-go');
  await page.waitForSelector('h3:has-text("Expediente cerrado")');
  ok(true, 'Impuestos cerró el expediente');
  await page.screenshot({ path: `${OUT}/16-impuestos-cerrado.png`, fullPage: true });
  await conMotivo(page, 'reabrir', 1);
  await page.waitForSelector('h3:has-text("Revisión final")');
  ok(await page.isVisible('text=Reabierto por auditoría'), 'Reabrir por auditoría lo regresa a revisión');
  await page.click('.crumbs a >> nth=1');
  await page.click('button[data-a=factura]');
  await page.fill('#fa-folio', 'FMK-A 20931');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('span.mono:has-text("FMK-A 20931")');
  await page.click('button[data-a=factura]');
  await page.selectOption('#fa-tipo', 'personal');
  await page.fill('#fa-folio', 'FMK-B 553');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('dd:has-text("FMK-B 553")');
  ok(await page.isVisible('div:has(> dt:has-text("Factura del evento")) >> text=FMK-A 20931'), 'Factura del evento y de días personales por separado');
  ok(await page.isVisible('text=USD 18,600.00'), 'Impuestos ve el monto registrado por Crédito');
  await page.check('[data-vg="1"]');
  await page.waitForSelector('text=1 de 10');
  await page.check('[data-vg="5"]');
  await page.waitForSelector('text=2 de 10');
  ok(await page.isVisible('text=Marcó el punto 5 de la verificación del grupo'), 'Cada punto marcado queda en la bitácora del grupo');
  await page.click('button[data-a=riesgo][data-k=medio]');
  await page.fill('#ri-nota', 'Tres habitaciones compartidas con una sola firma');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.riesgo.r-medio');
  ok(true, 'Impuestos registró el semáforo de riesgo');
  ok(await page.isVisible('.docrow.ok:has-text("Contrato del evento")'), 'Impuestos ve los documentos del evento');
  await page.screenshot({ path: `${OUT}/17-impuestos-grupo.png`, fullPage: true });
  await ctx.close();
}

// ---------------------------------------------------------------- 5. Permisos por área desde el servidor
{
  const { ctx, page } = await sesion('ipad', devices['iPad (gen 7) landscape']);
  await page.waitForSelector('text=Escanea el QR del huésped');
  const r = await page.evaluate(async () => (await fetch('/api/grupos')).status);
  ok(r === 403, `El iPad no puede ver la lista de grupos (${r})`);
  await ctx.close();
}
{
  const { ctx, page } = await sesion('credito');
  await page.waitForSelector('text=Expedientes por');
  const r = await page.evaluate(async () => (await fetch('/api/grupos', { method: 'POST', headers: { 'x-taxzero': '1', 'content-type': 'application/json' }, body: '{"nombre":"x","empresa":"y","llegada":"2026-01-01","salida":"2026-01-02"}' })).status);
  ok(r === 403, `Crédito no puede crear grupos (${r})`);
  await ctx.close();
}

// ---------------------------------------------------------------- 7. Reportes, bitácora general e impresión
const leerExcel = (f) => execFileSync('python3', ['-I', '-c',
  'import sys,openpyxl\nws=openpyxl.load_workbook(sys.argv[1]).active\nprint("\\n".join("|".join("" if c is None else str(c) for c in r) for r in ws.iter_rows(values_only=True)))', f]).toString();
{
  const { ctx, page } = await sesion('impuestos');
  await page.waitForSelector('text=Expedientes por');
  await page.click('a.tab:has-text("Avance")');
  await page.waitForSelector('h1:has-text("Avance por")');
  const fila = page.locator('table.avance tbody tr', { hasText: nombreGrupo });
  ok(await fila.count() === 1, 'El avance muestra el grupo de prueba');
  ok(/^3\b/.test(await fila.locator('td').nth(1).innerText()), 'Cuenta los huéspedes del grupo');
  await page.screenshot({ path: `${OUT}/19-avance.png`, fullPage: true });

  // Excel de la lista de huéspedes.
  await fila.locator('a').first().click();
  await page.waitForSelector(`h1:has-text("${nombreGrupo}")`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Descargar en Excel")')]);
  const fx = `${OUT}/lista.xlsx`;
  await dl.saveAs(fx);
  ok(/^Huespedes Convencion de prueba \d+ \d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), `Nombre del archivo: ${dl.suggestedFilename()}`);
  const txt = leerExcel(fx);
  ok(txt.includes(nombreGrupo) && txt.includes('Carter|Emily'), 'El Excel trae el grupo y al huésped');
  ok(txt.includes('FMK-A 20931') && txt.includes('USD 18,600.00'), 'El Excel trae el folio de factura y el monto registrado por Crédito');
  await page.reload();
  await page.waitForSelector('text=Descargó en Excel la lista de huéspedes del grupo');
  ok(true, 'La descarga queda en la bitácora del grupo');

  // Imprimir expediente.
  await page.click('tr:has-text("Carter") >> text=Abrir');
  await page.waitForSelector('h1:has-text("Emily Carter")');
  await page.click('a:has-text("Imprimir expediente")');
  await page.waitForSelector('.portada');
  await page.waitForFunction(() => [...document.querySelectorAll('.hoja img')].every((i) => i.complete && i.naturalWidth > 0));
  const titulos = await page.locator('.hoja-t b').allInnerTexts();
  ok(titulos.join(',').startsWith('Registration card,Pasaporte,Forma migratoria'), `Hojas en el orden del archivo físico (${titulos.join(', ')})`);
  await page.emulateMedia({ media: 'print' });
  ok(!(await page.isVisible('header.top')), 'Al imprimir no sale el menú de la página');
  await page.pdf({ path: `${OUT}/20-expediente-impreso.pdf`, format: 'Letter' });
  await page.emulateMedia({ media: 'screen' });
  ok(!(await page.isVisible('.portada >> text=Bitácora')), 'El expediente impreso ya no incluye la bitácora');

  // Expedientes de todo el grupo en un solo documento.
  await page.click('a:has-text("Volver al expediente")');
  await page.click(`.crumbs a:has-text("${nombreGrupo}")`);
  await page.click('a:has-text("Imprimir expedientes del grupo")');
  await page.waitForSelector('.impreso .portada h1');
  await page.waitForSelector('#imp-btn:not([disabled])', { timeout: 60000 });
  const portadas = await page.locator('.impreso .portada').count();
  ok(portadas >= 2 && (await page.isVisible('.impreso .portada >> text=Carter, Emily')), `El PDF del grupo trae la portada del grupo y un expediente por huésped (${portadas - 1})`);
  ok(!(await page.isVisible('.impreso >> text=Bitácora')), 'El PDF del grupo no incluye la bitácora');
  ok((await page.textContent('#imp-estado')).includes('listas') || (await page.textContent('#imp-estado')).includes('lista'), `Fotos cargadas antes de imprimir (${await page.textContent('#imp-estado')})`);
  await page.selectOption('#imp-solo', 'cerrado');
  const cerrados = await page.locator('.impreso .portada').count() - 1;
  ok(cerrados >= 1 && cerrados <= portadas - 1, `Filtro de solo cerrados (${cerrados})`);
  await page.selectOption('#imp-solo', '');
  await page.waitForSelector('#imp-btn:not([disabled])', { timeout: 60000 });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${OUT}/20b-grupo-impreso.pdf`, format: 'Letter' });
  await page.emulateMedia({ media: 'screen' });
  await page.goto(`${BASE}/#/grupos/${page.url().split('/grupos/')[1].split('/')[0]}`);
  await page.waitForSelector('text=Generó el PDF con los expedientes de todo el grupo');
  ok(true, 'Generar el PDF del grupo queda en la bitácora del grupo');

  // Bitácora general con filtros y Excel.
  await page.click('a.tab:has-text("Bitácora")');
  await page.waitForSelector('h1:has-text("Bitácora")');
  const gid = await page.locator('#bf-grupo option', { hasText: nombreGrupo }).getAttribute('value');
  await page.selectOption('#bf-grupo', gid);
  await page.fill('#bf-texto', 'cerrado');
  await page.click('form[data-form=bitacora] button[type=submit]');
  await page.waitForSelector('button:has-text("Quitar filtros")');
  const lineas = await page.locator('.log li').allInnerTexts();
  ok(lineas.length > 0 && lineas.every((l) => /cerr/i.test(l.split('\n')[0]) && l.includes(nombreGrupo)), `Filtra por grupo y acción (${lineas.length} movimientos)`);
  await page.selectOption('#bf-area', 'Crédito');
  await page.fill('#bf-texto', '');
  await page.click('form[data-form=bitacora] button[type=submit]');
  await page.waitForFunction(() => document.querySelector('a[data-descarga]').href.includes('area=') && document.querySelectorAll('.log li').length > 0);
  const deCredito = await page.locator('.log li .t:first-of-type').allInnerTexts();
  ok(deCredito.every((t) => t.includes('(Crédito)')), 'Filtra por área');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Descargar en Excel")')]);
  const fb = `${OUT}/bitacora.xlsx`;
  await dl2.saveAs(fb);
  const tb = leerExcel(fb);
  ok(tb.includes('Bitácora general de Taxzero') && tb.includes('área Crédito') && tb.includes('|Crédito|'), 'El Excel de la bitácora respeta los filtros');
  await page.click('button:has-text("Quitar filtros")');
  await page.waitForSelector('text=Descargó en Excel la bitácora general');
  ok(true, 'La descarga de la bitácora queda registrada');
  await page.screenshot({ path: `${OUT}/21-bitacora-general.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await sesion('frontdesk');
  await page.waitForSelector('a.tab:has-text("Grupos")');
  ok(!(await page.isVisible('a.tab:has-text("Bitácora")')), 'Front Desk no ve la bitácora general');
  const r = await page.evaluate(async () => [(await fetch('/api/bitacora')).status, (await fetch('/api/bitacora/excel')).status]);
  ok(r[0] === 403 && r[1] === 403, `Front Desk no puede consultar la bitácora general (${r})`);
  await ctx.close();
}
{
  const { ctx, page } = await sesion('credito');
  await page.waitForSelector('text=Expedientes por');
  const r = await page.evaluate(async () => (await fetch('/api/bitacora')).status);
  ok(r === 403, `Crédito no puede consultar la bitácora general (${r})`);
  await ctx.close();
}

// ---------------------------------------------------------------- 6. Administración de usuarios
if (C.admin[1]) {
  const correo = `prueba${sufijo}@example.com`;
  const nombre = `Usuario Prueba ${sufijo}`;
  const clave1 = `Inicial${sufijo}abc`;
  const clave2 = `Restab${sufijo}xyz9`;
  const clave3 = `MiPropia${sufijo}k2`;
  const fila = (page) => page.locator('tr', { hasText: correo });
  const { ctx, page } = await sesion('admin');
  await page.waitForSelector('a.tab:has-text("Usuarios")');
  await page.click('a.tab:has-text("Usuarios")');
  await page.waitForSelector('text=Bitácora de usuarios');
  ok(await page.isVisible('tr:has-text("(tú)")'), 'Administración ve la lista de usuarios');

  await page.click('button[data-a=usr-nuevo]');
  await page.fill('#un-nombre', nombre);
  await page.fill('#un-email', correo);
  await page.selectOption('#un-rol', 'frontdesk');
  await page.fill('#un-clave', 'corta1');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.modal .err:has-text("10 caracteres")');
  ok(true, 'Rechaza una contraseña corta');
  await page.click('button[data-a=gen-clave]');
  const gen = await page.inputValue('#un-clave');
  ok(/^(?=.*[A-Za-z])(?=.*\d).{12}$/.test(gen), 'El botón Generar propone una contraseña válida');
  await page.fill('#un-clave', clave1);
  await page.click('.modal button[type=submit]');
  await fila(page).waitFor();
  ok(await fila(page).locator('text=Nunca ha entrado').isVisible(), 'Usuario dado de alta, aún sin acceso');
  await page.click('button[data-a=usr-nuevo]');
  await page.fill('#un-nombre', 'Duplicado');
  await page.fill('#un-email', correo.toUpperCase());
  await page.selectOption('#un-rol', 'grupos');
  await page.fill('#un-clave', clave1);
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.modal .err:has-text("Ya existe")');
  ok(true, 'No permite dos usuarios con el mismo correo');
  await page.click('.modal button[data-a=cerrar-modal]');

  // El nuevo usuario entra a Front Desk.
  let u = await sesion('nuevo', {}, [correo, clave1]);
  await u.page.waitForSelector('.who:has-text("Front Desk")');
  const r403 = await u.page.evaluate(async () => (await fetch('/api/usuarios')).status);
  ok(r403 === 403, `Un usuario de otra área no puede ver los usuarios (${r403})`);
  await u.ctx.close();

  // Cambiar área.
  await page.reload();
  await fila(page).waitFor();
  await fila(page).locator('button[data-a=usr-area]').click();
  await page.selectOption('#ua-rol', 'credito');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector(`tr:has-text("${correo}") >> text=Crédito`);
  ok(await page.isVisible('text=Cambió el área de ' + nombre), 'El cambio de área queda en la bitácora de usuarios');

  // Restablecer contraseña: la anterior deja de servir.
  await fila(page).locator('button[data-a=usr-clave]').click();
  await page.fill('#uc-clave', clave2);
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('text=Restableció la contraseña de ' + nombre);
  u = await sesion('nuevo', {}, [correo, clave1]);
  await u.page.waitForSelector('.err:not([hidden])');
  ok(true, 'La contraseña anterior ya no entra');
  await u.ctx.close();
  u = await sesion('nuevo', {}, [correo, clave2]);
  await u.page.waitForSelector('text=Expedientes por');
  ok(true, 'Entra con la contraseña restablecida, ya en Crédito');

  // Cambiar su propia contraseña.
  await u.page.click('button[data-a=miclave]');
  await u.page.fill('#mc-actual', 'equivocada123');
  await u.page.fill('#mc-nueva', clave3);
  await u.page.fill('#mc-otra', clave3);
  await u.page.click('.modal button[type=submit]');
  await u.page.waitForSelector('.modal .err:has-text("actual no es correcta")');
  await u.page.fill('#mc-actual', clave2);
  await u.page.click('.modal button[type=submit]');
  await u.page.waitForSelector('text=Contraseña cambiada');
  ok(true, 'El usuario cambió su propia contraseña');
  await u.ctx.close();

  // Desactivar: pide motivo, cierra sesión y ya no entra.
  await page.reload();
  await fila(page).waitFor();
  await fila(page).locator('button[data-a=usr-estado]').click();
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.modal .err:has-text("motivo")');
  await page.selectOption('#ue-motivo', 'Cambió de departamento');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector(`tr.inactivo:has-text("${correo}")`);
  ok(await page.isVisible('text=Desactivó al usuario ' + nombre), 'Desactivado con motivo en la bitácora');
  u = await sesion('nuevo', {}, [correo, clave3]);
  await u.page.waitForSelector('.err:not([hidden])');
  ok(true, 'Un usuario desactivado no puede entrar');
  await u.ctx.close();

  await fila(page).locator('button[data-a=usr-estado]').click();
  await page.click('.modal button[type=submit]');
  await page.waitForSelector(`tr:not(.inactivo):has-text("${correo}")`);
  u = await sesion('nuevo', {}, [correo, clave3]);
  await u.page.waitForSelector('text=Expedientes por');
  ok(true, 'Reactivado, vuelve a entrar con su contraseña');
  await u.ctx.close();
  ok(!(await page.isVisible('tr:has-text("(tú)") button[data-a=usr-estado]')), 'Administración no puede desactivarse a sí misma');
  await page.screenshot({ path: `${OUT}/18-usuarios.png`, fullPage: true });
  await ctx.close();

  // La bitácora de usuarios no la ven las demás áreas.
  const g = await sesion('grupos');
  await g.page.waitForSelector("text=Expedientes por");
  const r = await g.page.evaluate(async () => (await fetch('/api/usuarios', { method: 'POST', headers: { 'x-taxzero': '1', 'content-type': 'application/json' }, body: '{"email":"x@example.com","clave":"abcdefghij1","nombre":"Intruso","rol":"admin"}' })).status);
  ok(r === 403, `Grupos no puede dar de alta usuarios (${r})`);
  await g.ctx.close();
} else {
  console.log('· Sin CLAVE_ADMIN: se omiten las pruebas de usuarios');
}

// ---------------------------------------------------------------- 7b. Grupos cancela un grupo
{
  const nombreCancel = `Grupo cancelado ${sufijo}`;
  const { ctx, page } = await sesion('grupos');
  await page.waitForSelector('text=Expedientes por');
  const { id: idCancel } = await page.evaluate(async (b) => (await fetch('/api/grupos', { method: 'POST', headers: { 'x-taxzero': '1', 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(),
    { nombre: nombreCancel, empresa: 'Fabrikam', llegada: diaCancun(10), salida: diaCancun(13), evento: { tipo: 'congreso', organizador: 'Fabrikam Association', pais_codigo: 'USA', pais: 'Estados Unidos' } });
  await page.goto(`${BASE}/#/grupos/${idCancel}`);
  await page.waitForSelector(`h1:has-text("${nombreCancel}")`);
  await page.click('button[data-a=cancelgrupo]');
  await page.click('.modal button[type=submit]');
  ok(await page.isVisible('#cg-err:has-text("motivo")'), 'Cancelar el grupo exige motivo');
  await page.fill('#cg-motivo', 'El cliente canceló el evento');
  await page.screenshot({ path: `${OUT}/23-cancelar-grupo.png` });
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.notice.cancelado');
  ok(await page.isVisible('.log >> text=Canceló el grupo'), 'La cancelación queda en la bitácora del grupo');
  ok(await page.isVisible('.log >> text=El cliente canceló el evento'), 'El motivo de la cancelación queda en la bitácora');
  await page.screenshot({ path: `${OUT}/24-grupo-cancelado.png`, fullPage: true });
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('.tablero-bar');
  await page.click('[data-a=etapa][data-k=llegar]');
  ok(!(await page.isVisible(`.gcard:has-text("${nombreCancel}")`)), 'El grupo cancelado ya no aparece en Por llegar');
  await page.click('[data-a=etapa][data-k=cancelados]');
  ok(await page.isVisible(`.gcard:has-text("${nombreCancel}") >> text=Cancelado`), 'El grupo cancelado aparece en la pestaña Cancelados');
  await page.screenshot({ path: `${OUT}/25-tablero-cancelados.png` });
  await ctx.close();

  const fd = await sesion('frontdesk');
  await fd.page.waitForSelector('.tablero-bar');
  ok(!(await fd.page.isVisible('[data-a=etapa][data-k=cancelados]')), 'Front Desk no tiene la pestaña Cancelados');
  const r = await fd.page.evaluate(async (id) => {
    const lista = (await (await fetch('/api/grupos')).json()).grupos.some((g) => g.id === id);
    const alta = (await fetch(`/api/grupos/${id}/huespedes`, { method: 'POST', headers: { 'x-taxzero': '1', 'content-type': 'application/json' }, body: '{"nombre":"A","apellidos":"B","nacionalidad_codigo":"USA","nacionalidad":"Estados Unidos"}' })).status;
    return { lista, alta };
  }, idCancel);
  ok(!r.lista && r.alta === 403, `Front Desk no ve el grupo cancelado ni puede dar de alta huéspedes (${r.alta})`);
  await fd.ctx.close();

  if (C.admin[1]) {
    const ad = await sesion('admin');
    await ad.page.waitForSelector('header.top');
    const alta = await ad.page.evaluate(async (id) => (await fetch(`/api/grupos/${id}/huespedes`, { method: 'POST', headers: { 'x-taxzero': '1', 'content-type': 'application/json' }, body: '{"nombre":"A","apellidos":"B","nacionalidad_codigo":"USA","nacionalidad":"Estados Unidos"}' })).status, idCancel);
    ok(alta >= 400, `La base no deja dar de alta huéspedes en un grupo cancelado (${alta})`);
    await ad.page.goto(`${BASE}/#/grupos/${idCancel}`);
    await ad.page.waitForSelector('.notice.cancelado');
    ok(!(await ad.page.isVisible('text=Dar de alta un huésped')), 'En un grupo cancelado no aparece el alta de huéspedes');
    await ad.page.click('button[data-a=cancelgrupo][data-k=reactivar]');
    await ad.page.fill('#cg-motivo', 'Se canceló por error');
    await ad.page.click('.modal button[type=submit]');
    await ad.page.waitForSelector('button[data-a=cancelgrupo][data-k=cancelar]');
    ok(await ad.page.isVisible('.log >> text=Reactivó el grupo cancelado'), 'La reactivación queda en la bitácora');
    await ad.ctx.close();
  }
}

// ---------------------------------------------------------------- 8. Aviso de privacidad público
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/aviso-de-privacidad`);
  await page.waitForSelector('h2:has-text("Aviso de privacidad integral")');
  ok(await page.isVisible('h2:has-text("Privacy notice")'), 'El aviso completo se abre sin sesión, en español e inglés');
  await page.screenshot({ path: `${OUT}/22-aviso-publico.png`, fullPage: true });
  await page.click('text=Ir al inicio de sesión');
  await page.waitForSelector('#l-email');
  ok(true, 'Desde el aviso se regresa al inicio de sesión');
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/resultado.txt`, fallos ? `FALLOS: ${fallos}\n` : 'OK\n');
console.log(fallos ? `\n${fallos} verificaciones fallaron` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
