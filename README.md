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

## Etapa 4: administración de usuarios

- Administración tiene la pantalla **Usuarios**: da de alta usuarios (nombre, correo, área y contraseña inicial,
  con botón para generar una), cambia su área, restablece su contraseña y los desactiva o reactiva.
- Los usuarios no se borran: al desactivar se pide el motivo, se cierran sus sesiones y ya no pueden entrar.
  Su nombre sigue en las bitácoras.
- Administración no puede cambiar su propia área ni desactivarse a sí misma.
- Cualquier usuario cambia su propia contraseña desde "Cambiar contraseña" (pide la actual).
  Las estaciones de iPad no tienen esa opción; su contraseña la restablece Administración.
- Contraseñas: al menos 10 caracteres, con letras y números. Se guardan cifradas por Supabase Auth.
- La bitácora de usuarios solo la ve Administración.

## Etapa 5: reportes y bitácora general

- **Avance**: tabla de todos los grupos con cuántos expedientes hay en cada paso (por capturar, Grupos, Crédito,
  Impuestos, cerrados, no aplica) y cuántos están detenidos (3 días o más sin movimiento y sin cerrar).
  En cada grupo se marcan los expedientes detenidos y hay un filtro para verlos. Solo cuenta expedientes; no calcula montos.
- **Descargar en Excel** la lista de huéspedes de un grupo (Grupos, Crédito, Impuestos y Administración), con los datos
  del grupo, el organizador, los folios de factura y el monto registrado por Crédito tal como se capturó.
- **Bitácora general** (Administración e Impuestos): todos los movimientos, con filtros por fechas, área, grupo, persona
  y acción, y descarga en Excel con los mismos filtros.
- Cada descarga en Excel queda en la bitácora (quién y cuándo).
- **Imprimir expediente**: portada con los datos del huésped y su bitácora, y una hoja por documento en el orden del
  archivo físico (versión vigente de cada uno).

Pendiente: aviso de privacidad, respaldo nocturno y contraseñas definitivas antes de usar datos reales.

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
CLAVE_GRUPOS=... CLAVE_FRONTDESK=... CLAVE_IPAD=... CLAVE_CREDITO=... CLAVE_IMPUESTOS=... CLAVE_ADMIN=... node tests/e2e.mjs
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
- Desactivar el registro abierto en Supabase Auth (los usuarios ya se dan de alta desde la app) (Authentication → Sign In / Providers → Allow new users to sign up: off)
  y activar la protección de contraseñas filtradas.
- Cambiar las contraseñas de prueba o borrar esos usuarios del proyecto de pruebas.
- Considerar R2 para las fotos: un grupo de 500 huéspedes son ~2,000 fotos (~0.6 GB); el plan gratuito de Supabase
  Storage tiene 1 GB y R2 10 GB.

## Aviso de privacidad (aprobado por el área legal)

- **Personal:** al entrar por primera vez, cada usuario lee y acepta el aviso de privacidad y el compromiso de
  confidencialidad. Sin aceptarlo no puede ver ni cambiar nada. La aceptación queda en la bitácora de usuarios.
- **Huésped (iPad):** después de escanear el QR, el iPad muestra el aviso en español e inglés, con un QR para leer el
  aviso completo en su teléfono. Sin *Acepto* no se puede tomar ni guardar ninguna foto. Si el huésped no acepta,
  queda anotado en su expediente y la captura se cierra sin fotos.
- **Aviso completo:** en `/#/aviso-de-privacidad`, sin necesidad de sesión.
- El texto está en `src/client/aviso.js`. Al cambiar el texto se sube la
  versión (también en `src/worker/index.ts`) y todos vuelven a aceptarlo.

## Documentos en Cloudflare R2

- Las fotos de los huéspedes y los documentos del evento se guardan en el bucket privado `taxzero-documentos`
  de Cloudflare R2. No tiene acceso público: solo la app los guarda y los entrega, y solo a quien tiene permiso.
- Antes de guardar, la app pregunta a la base si ese usuario puede subir a esa carpeta (por ejemplo, el iPad solo si
  el huésped aceptó el aviso y la captura sigue activa).
- El bucket tiene una regla de candado (*bucket lock*) indefinida: ningún archivo se puede borrar ni reemplazar.
- Los archivos de prueba guardados antes de este cambio siguen en Supabase Storage y se leen desde ahí.

## Dirección

- La app se publica solo en **https://taxzero.opsmyk.com** (dominio propio en Cloudflare). Las direcciones
  `*.workers.dev` están apagadas (`workers_dev` y `preview_urls` en `false`).

## Tablero y datos de grupos

- La lista de grupos se divide por etapa de la estancia, con la fecha de hoy en hora de Cancún:
  **En casa** (llegó y no ha pasado su salida), **Por llegar** y **Ya salieron**, más **Todos** y un buscador.
- Grupos y Administración pueden corregir los datos del grupo con motivo obligatorio. Cada dato cambiado deja una
  línea en la bitácora del grupo con el valor anterior y el nuevo (`editar_grupo`, migración 0012).
- Si el grupo ya tiene expedientes cerrados, la empresa y las fechas de estancia quedan fijas; Impuestos debe
  reabrir esos expedientes para corregirlas.
- No se puede dar de alta un grupo con llegada anterior a hoy (se valida en la página, en el servidor y en la base).
- Front Desk no ve la pestaña Avance ni los datos de expedientes detenidos.
- Filtro por año de llegada en el tablero (los grupos se conservan para siempre).
- Front Desk solo ve grupos en casa o por llegar; el servidor le niega los grupos cuya salida ya pasó (lista, ficha, expedientes, fotos, QR y alta de huéspedes).
- Icono con el logo de Fairmont y aviso de copyright (© Cristian Lázaro) al pie de las pantallas de PC y del inicio de sesión.
- Grupos y Administración pueden **cancelar** un grupo con motivo obligatorio (y reactivarlo, también con motivo).
  No se borra nada: el grupo pasa a la pestaña **Cancelados**, Front Desk deja de verlo y la base no acepta
  huéspedes, códigos QR ni fotos nuevas mientras siga cancelado. Cada cancelación o reactivación queda en
  `cancelaciones_grupo` y en la bitácora del grupo (migración 0014).

## Documentos de Crédito por grupo

- En la ficha del grupo, Crédito sube la autorización de la devolución (firmada por Impuestos y Cuentas por Cobrar),
  el cálculo o conciliación, los reportes de Opera con el ajuste y documentos extraordinarios (con descripción
  obligatoria), y registra el folio de Opera de la cuenta maestra con la devolución.
- Los ven Crédito, Impuestos y Administración. Nada se reemplaza ni se borra; todo queda en la bitácora del grupo
  (migración 0013). El rooming list sigue en los documentos generales del grupo.
