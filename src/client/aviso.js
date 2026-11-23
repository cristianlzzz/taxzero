// Aviso de privacidad (LFPDPPP). Aprobado por el área legal del hotel (2026-11-23).
// Al cambiar cualquier texto, sube AVISO_VERSION (y la de src/worker/index.ts): todos los
// usuarios lo vuelven a aceptar al entrar y cada huésped acepta la versión vigente.
// Los datos entre {{ }} están pendientes de confirmar y se muestran resaltados.

export const AVISO_VERSION = '2026-11-v1';
export const AVISO_BORRADOR = false;
export const RUTA_AVISO = '#/aviso-de-privacidad';

const RESPONSABLE = 'OPERADORA HOTELERA DEL CORREDOR MAYAKOBA';
const DOMICILIO = 'Carretera Federal Cancún–Chetumal km 298, 77710 Playa del Carmen, Quintana Roo';
const CORREO = 'mayakoba@fairmont.com';

// Aviso integral, en español y en inglés (el huésped es extranjero).
export const AVISO_INTEGRAL = {
  es: {
    titulo: 'Aviso de privacidad integral',
    secciones: [
      ['Quién es responsable de sus datos',
        `${RESPONSABLE}, que opera el hotel Fairmont Mayakoba, con domicilio en ${DOMICILIO}, es responsable del tratamiento de los datos personales que se recaban para el trámite del beneficio fiscal de IVA para participantes de congresos, convenciones, exposiciones y ferias (artículo 29 de la Ley del IVA).`],
      ['Qué datos recabamos',
        'Nombre y apellidos, nacionalidad, número y vigencia del pasaporte, imagen del pasaporte, documento migratorio (forma migratoria, sello de entrada o QR de internación), registration card con su firma, comprobante de pago (solo los últimos 4 dígitos de la tarjeta), gafete o constancia de participación en el evento y fechas de estancia. No recabamos datos personales sensibles.'],
      ['Para qué usamos sus datos',
        'Finalidades necesarias: (1) integrar el expediente que acredita que usted es participante extranjero del evento; (2) aplicar la tasa de IVA que corresponde a su hospedaje y servicios del evento; (3) cumplir las obligaciones fiscales del hotel y atender revisiones o auditorías de las autoridades. No usamos sus datos para mercadotecnia, publicidad ni otras finalidades.'],
      ['Con quién compartimos sus datos',
        'Con el Servicio de Administración Tributaria y otras autoridades competentes cuando lo requieran conforme a la ley; estas transferencias no requieren su consentimiento. También los tratan, por cuenta del hotel y bajo contrato de confidencialidad, los proveedores que alojan el sistema y los documentos. No vendemos ni cedemos sus datos a terceros.'],
      ['Cuánto tiempo los conservamos',
        'Durante el plazo que exijan las disposiciones fiscales para conservar la contabilidad y la documentación que la soporta. Después se bloquean y se suprimen conforme a la ley.'],
      ['Cómo protegemos sus datos',
        'Solo el personal autorizado de cada área puede ver el expediente, cada consulta y cambio queda registrado y los documentos se guardan cifrados y protegidos contra borrado.'],
      ['Sus derechos (ARCO) y cómo revocar su consentimiento',
        `Usted puede acceder a sus datos, rectificarlos, cancelarlos u oponerse a su tratamiento, así como revocar su consentimiento o limitar su uso, escribiendo a ${CORREO}. Indique su nombre, el grupo o evento, lo que solicita y adjunte una identificación. Le responderemos en un máximo de 20 días hábiles. Si revoca su consentimiento o se opone, el hotel no podrá tramitar el beneficio fiscal a su favor, sin perjuicio de conservar lo que la ley obligue.`],
      ['Cambios a este aviso',
        'Cualquier cambio se publicará en esta misma página y se le presentará en la estación de captura antes de recabar sus documentos.'],
    ],
  },
  en: {
    titulo: 'Privacy notice (English)',
    secciones: [
      ['Who is responsible for your data',
        `${RESPONSABLE}, operator of the Fairmont Mayakoba hotel, located at ${DOMICILIO}, is responsible for the personal data collected to process the VAT tax benefit for foreign participants of congresses, conventions, exhibitions and fairs (article 29 of the Mexican VAT Law).`],
      ['What data we collect',
        'Full name, nationality, passport number and expiration date, an image of your passport, your immigration document (immigration form, entry stamp or entry QR), your signed registration card, proof of payment (only the last 4 digits of the card), your event badge or certificate of attendance and the dates of your stay. We do not collect sensitive personal data.'],
      ['Why we use your data',
        'Required purposes: (1) to build the file that proves you are a foreign participant of the event; (2) to apply the correct VAT rate to your lodging and event services; (3) to comply with the hotel’s tax obligations and respond to reviews or audits by the authorities. We do not use your data for marketing, advertising or any other purpose.'],
      ['Who we share your data with',
        'With the Mexican Tax Administration Service (SAT) and other competent authorities when required by law; these transfers do not require your consent. Service providers that host the system and the documents also process them on the hotel’s behalf under confidentiality agreements. We do not sell or give your data to third parties.'],
      ['How long we keep it',
        'For the period required by tax regulations to keep accounting records and supporting documents. Afterwards it is blocked and deleted as required by law.'],
      ['How we protect it',
        'Only authorized staff of each department can see the file, every access and change is logged, and documents are stored encrypted and protected against deletion.'],
      ['Your rights and how to withdraw consent',
        `You may access, correct or cancel your data, object to its use, withdraw your consent or limit its use by writing to ${CORREO}. Include your name, group or event, your request and a copy of your ID. We will reply within 20 business days. If you withdraw your consent or object, the hotel will not be able to process the tax benefit for you, although it will keep what the law requires.`],
      ['Changes to this notice',
        'Any change will be published on this same page and shown to you at the capture station before your documents are collected.'],
    ],
  },
};

// Lo que lee el huésped en el iPad antes de las fotos.
export const AVISO_HUESPED = {
  es: {
    titulo: 'Antes de tomar las fotos de sus documentos',
    texto: `${RESPONSABLE} (Fairmont Mayakoba) tomará fotos de su pasaporte, documento migratorio, registration card firmada, comprobante de pago (solo últimos 4 dígitos) y gafete del evento. Las usamos únicamente para tramitar el beneficio fiscal de IVA de su participación en el evento y para cumplir obligaciones fiscales; podemos compartirlas con el SAT cuando la ley lo requiera. Puede ejercer sus derechos ARCO o revocar su consentimiento en ${CORREO}.`,
  },
  en: {
    titulo: 'Before we photograph your documents',
    texto: `${RESPONSABLE} (Fairmont Mayakoba) will photograph your passport, immigration document, signed registration card, proof of payment (last 4 digits only) and event badge. We use them only to process the VAT tax benefit for your participation in the event and to meet tax obligations; we may share them with the Mexican tax authority (SAT) when required by law. You may exercise your privacy rights or withdraw consent at ${CORREO}.`,
  },
};

// Lo que acepta cada usuario al entrar por primera vez.
export const AVISO_PERSONAL = {
  titulo: 'Aviso de privacidad y compromiso de confidencialidad',
  puntos: [
    'Taxzero guarda datos personales de huéspedes extranjeros (pasaporte, documentos migratorios, firma y comprobantes de pago) protegidos por la Ley Federal de Protección de Datos Personales en Posesión de los Particulares.',
    'Me comprometo a usar esa información solo para el trámite del beneficio fiscal de IVA y para las tareas de mi área.',
    'No descargaré, fotografiaré, copiaré ni compartiré documentos o datos de huéspedes fuera de Taxzero, salvo los reportes que la propia página permite a mi área.',
    'No compartiré mi usuario ni mi contraseña y cerraré sesión al terminar en equipos compartidos.',
    'Sé que cada consulta, descarga y cambio queda registrado con mi nombre.',
    'Mis propios datos (nombre, correo, área y actividad en la página) se usan solo para controlar el acceso y la bitácora del sistema.',
  ],
};

// Convierte el texto a HTML, resaltando lo pendiente de confirmar.
export function avisoHTML(texto, esc) {
  return esc(texto).replace(/\{\{(.*?)\}\}/g, (_, x) => (AVISO_BORRADOR ? `<mark class="pend">${x}</mark>` : ''));
}
