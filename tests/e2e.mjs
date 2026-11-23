// Prueba de punta a punta del flujo de la etapa 1 contra un servidor local.
// Uso: BASE=http://127.0.0.1:8787 node tests/e2e.mjs  (requiere las claves de prueba en env)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

// Playwright viene instalado en el equipo de pruebas, no como dependencia del proyecto.
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = process.env.OUT || 'tests/salida';
const C = {
  grupos: ['grupos.taxzero@example.com', process.env.CLAVE_GRUPOS],
  frontdesk: ['frontdesk.taxzero@example.com', process.env.CLAVE_FRONTDESK],
  ipad: ['ipad1.taxzero@example.com', process.env.CLAVE_IPAD],
  credito: ['credito.taxzero@example.com', process.env.CLAVE_CREDITO],
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

async function sesion(rol, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok(false, `error de página (${rol}): ${e.message}`));
  await page.goto(BASE);
  await page.fill('#l-email', C[rol][0]);
  await page.fill('#l-clave', C[rol][1]);
  await page.click('button[type=submit]');
  return { ctx, page };
}

const F = await fotos();
const sufijo = Date.now().toString().slice(-5);
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
  await page.fill('#a-llegada', '2026-11-20');
  await page.fill('#a-salida', '2026-11-24');
  await page.fill('#a-est', '450');
  await page.fill('#a-codigo', `GRP-${sufijo}`);
  await page.screenshot({ path: `${OUT}/02-alta-grupo.png` });
  await page.click('button:has-text("Crear grupo")');
  await page.waitForSelector(`h1:has-text("${nombreGrupo}")`);
  ok(true, 'Grupos creó el grupo');
  ok(!(await page.isVisible('text=Dar de alta un huésped')), 'Grupos no ve el alta de huéspedes');
  await ctx.close();
}

// ---------------------------------------------------------------- 2. Front Desk da de alta huéspedes y genera QR
let codigo, codigo2;
{
  const { ctx, page } = await sesion('frontdesk');
  await page.waitForSelector('text=dar de alta');
  ok(!(await page.isVisible('text=Dar de alta un grupo')), 'Front Desk no ve el alta de grupos');
  await page.click(`a.gcard:has-text("${nombreGrupo}")`);
  await page.click('text=Dar de alta un huésped');
  await page.fill('#h-nom', 'Emily');
  await page.fill('#h-ape', 'Carter');
  await page.selectOption('#h-nac', 'USA');
  await page.fill('#h-pas', 'p 1234 5678');
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
  await page.waitForSelector('h1:has-text("Emily Carter")');
  ok(await page.isVisible('text=Paso 1 de 4'), 'La captura pide 4 documentos');

  // Pasaporte: primero una foto borrosa
  await page.setInputFiles('#foto', F['pasaporte-b']);
  await page.waitForSelector('text=La foto parece borrosa');
  ok(true, 'Detecta foto borrosa');
  await page.screenshot({ path: `${OUT}/07-ipad-borrosa.png` });
  await page.setInputFiles('#foto', F.pasaporte);
  await page.waitForSelector('button:has-text("Usar esta foto")');
  await page.screenshot({ path: `${OUT}/08-ipad-preview.png` });
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Paso 2 de 4');
  for (const [t, paso] of [['regcard', 3], ['pago', 4]]) {
    await page.setInputFiles('#foto', F[t]);
    await page.click('button:has-text("Usar esta foto")');
    await page.waitForSelector(`text=Paso ${paso} de 4`);
  }
  await page.click('button[data-k="sello"]');
  await page.setInputFiles('#foto', F.fmm);
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
  await page.setInputFiles('#foto', F.pasaporte);
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Paso 2 de 4');
  await page.setInputFiles('#foto', F.regcard);
  await page.click('button:has-text("Usar esta foto")');
  await page.waitForSelector('text=Paso 3 de 4');
  await page.click('text=El huésped no lo trae');
  await page.waitForSelector('text=Paso 4 de 4');
  await page.click('text=El huésped no lo trae');
  await page.waitForSelector('text=Guardar como incompleta');
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
  ok(n === 4, `Grupos ve las 4 fotos del expediente (${n})`);
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

await browser.close();
writeFileSync(`${OUT}/resultado.txt`, fallos ? `FALLOS: ${fallos}\n` : 'OK\n');
console.log(fallos ? `\n${fallos} verificaciones fallaron` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
