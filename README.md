# Taxzero

App interna para los expedientes tax free (art. 29 fr. VIII LIVA) de huéspedes de grupos y convenciones.
Cada área entra con su usuario y ve solo su módulo. La página no calcula montos ni porcentajes: solo guarda
información, y nada se borra.

## Qué incluye la etapa 1

- **Inicio de sesión** con un rol por área: Grupos, Front Desk, iPad de captura, Crédito, Impuestos y Administración.
- **Grupos (PC):** alta de grupos y vista de sus expedientes.
- **Front Desk (PC):** alta de huéspedes (sin habitación ni reservación de Opera; nacionalidad desde lista de países,
  México avisa que no aplica) y código QR de captura. El QR no lleva datos personales, sirve una vez y vence a los 15 min.
- **Estación de captura (iPad):** escanea el QR con la cámara (o se escribe el código), toma las fotos de pasaporte,
  registration card, comprobante de pago y forma migratoria, avisa si una foto salió borrosa y envía a Grupos. Si falta
  algo, queda como *Captura incompleta*. Si el código vence a media captura, lo tomado se guarda.
- **Expediente (PC):** fotos reales con versiones (las anteriores se conservan), ampliación a tamaño real y bitácora.

## Etapa 2: revisiones

- **Grupos:** lista de verificación (nombre, firma, nacionalidad, fechas) que habilita *Aprobar y enviar a Crédito*;
  *Pedir recaptura* de documentos específicos (Front Desk genera otro QR y el iPad solo pide esos); *No aplica*.
- **Crédito:** verificación del comprobante, *Validar y enviar a Impuestos* o *Devolver a Grupos*; monto final de
  devolución por grupo (un monto nuevo deja visible el anterior). La página no calcula el monto.
- **Impuestos:** documentos en el orden del archivo físico, *Cerrar expediente* o *Devolver a Crédito*, folio de
  factura por grupo y *Reabrir por auditoría*.
- Toda devolución, recaptura, No aplica o reapertura exige motivo y queda en la bitácora. Si otra persona ya cambió el
  expediente, la acción se rechaza y la pantalla se actualiza.

## Etapa 3: expediente del evento (guía interna de estímulo fiscal)

- **Grupos:** al dar de alta el grupo se registra el tipo de evento (congreso, convención, exposición o feria) y el
  organizador (país de residencia e identificación fiscal extranjera). En el grupo, *Documentos del evento*: contrato,
  agenda, evidencia de salones, lista oficial de asistentes, identificación fiscal del organizador, gafetes o
  constancias y rooming list. PDF o foto; el rooming list también en Excel. Un archivo nuevo no reemplaza al anterior.
- **Huésped:** vencimiento del pasaporte (Front Desk en el alta o Grupos en la revisión; Grupos no puede aprobar sin
  él) y aviso si vence antes de la salida del grupo. El iPad ofrece al final un paso opcional para el gafete o
  constancia, que no deja el expediente incompleto si falta.
- **Crédito:** verificación de que el pago es con tarjeta extranjera o transferencia internacional.
- **Impuestos:** lista de 10 puntos del grupo (cada marca se guarda con nombre y hora), semáforo de riesgo con motivo,
  y folios separados para la factura del evento y la de días personales.
- Cada grupo muestra su propia bitácora. Las listas de verificación de cada área se ampliaron con los puntos de la guía.

Pendiente: administración de usuarios, reportes y bitácora general.

## Cómo está hecho

| Pieza | Dónde |
|---|---|
| Servidor y página | Cloudflare Workers (`src/worker`), página en `public/` + `src/client` |
| Base de datos y usuarios | Supabase (Postgres + Auth), migraciones en `supabase/migrations` |
| Fotos de documentos | Supabase Storage, bucket privado `documentos` (se puede cambiar a Cloudflare R2) |

Reglas que aplica la base de datos, no solo la página:

- Las tablas solo se leen desde la app; toda escritura pasa por funciones que validan el rol y escriben la bitácora.
- Triggers impiden borrar registros y modificar la bitácora o los documentos.
- Las fotos no se pueden reemplazar ni borrar; cada recaptura es una versión nueva.
- El iPad no puede listar grupos ni ver expedientes: solo sube fotos al expediente de un código activo.
- Un cron cada 5 minutos cierra las capturas cuyo código venció.

## Desarrollo local

```bash
npm install
npm run dev        # compila la página y arranca el Worker en http://localhost:8787
npm test           # pruebas unitarias
```

`wrangler.jsonc` ya trae la URL y la llave publicable del proyecto de pruebas de Supabase. Para apuntar a otro
proyecto, crea `.dev.vars` con `SUPABASE_URL=...` y `SUPABASE_ANON_KEY=...`.

Prueba de punta a punta (con el servidor local corriendo):

```bash
CLAVE_GRUPOS=... CLAVE_FRONTDESK=... CLAVE_IPAD=... CLAVE_CREDITO=... CLAVE_IMPUESTOS=... node tests/e2e.mjs
```

## Base de datos

Aplica las migraciones en orden (`supabase/migrations/0001…`) desde el editor SQL de Supabase o con la CLI.
`scripts/usuarios-prueba.sql` crea un usuario por área para pruebas (cambia las contraseñas antes de ejecutarlo).

## Publicar

```bash
npx wrangler login
npm run deploy
```

O conecta este repositorio en Cloudflare (Workers → Create → Import a repository) con el comando de build
`npm run build` y de deploy `npx wrangler deploy`.

## Antes de usar datos reales

- Aviso de privacidad del hotel (LFPDPPP) publicado y aceptado.
- Desactivar el registro abierto en Supabase Auth (Authentication → Sign In / Providers → Allow new users to sign up: off)
  y activar la protección de contraseñas filtradas.
- Cambiar las contraseñas de prueba o borrar esos usuarios del proyecto de pruebas.
- Considerar R2 para las fotos: un grupo de 500 huéspedes son ~2,000 fotos (~0.6 GB); el plan gratuito de Supabase
  Storage tiene 1 GB y R2 10 GB.
