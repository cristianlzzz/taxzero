// Catálogos de la app. Textos en español.
export const ROLES = {
  admin: { label: 'Administración', where: 'PC' },
  grupos: { label: 'Grupos', where: 'PC' },
  frontdesk: { label: 'Front Desk', where: 'PC' },
  ipad: { label: 'iPad de captura', where: 'iPad' },
  credito: { label: 'Crédito', where: 'PC' },
  impuestos: { label: 'Impuestos', where: 'PC' },
};
export const ESTADOS = {
  pendiente: 'Pendiente de captura', incompleta: 'Captura incompleta', rev_grupos: 'En revisión de Grupos',
  val_credito: 'En validación de Crédito', rev_impuestos: 'En revisión de Impuestos', cerrado: 'Cerrado',
  dev_grupos: 'Devuelto a Grupos', dev_credito: 'Devuelto a Crédito', no_aplica: 'No aplica',
};
export const QUEUE = {
  frontdesk: ['pendiente', 'incompleta'], grupos: ['rev_grupos', 'dev_grupos'],
  credito: ['val_credito', 'dev_credito'], impuestos: ['rev_impuestos'], admin: [],
};
export const QUEUE_WORD = {
  frontdesk: 'por capturar', grupos: 'por revisar', credito: 'por validar', impuestos: 'por cerrar', admin: 'en proceso',
};
export const DOCS = {
  pasaporte: { label: 'Pasaporte', hint: 'Página de la foto completa, sin reflejos sobre los datos.' },
  regcard: { label: 'Registration card', hint: 'Tarjeta de Opera firmada. Que se vea la firma completa.' },
  pago: { label: 'Comprobante de pago', hint: 'Voucher o comprobante a nombre del huésped. Solo deben verse los últimos 4 dígitos de la tarjeta.' },
  fmm: { label: 'Forma migratoria', hint: 'FMM, sello de entrada en el pasaporte o QR de internación.' },
};
export const DOC_ORDER = ['pasaporte', 'regcard', 'pago', 'fmm'];
export const FILE_ORDER = ['regcard', 'pasaporte', 'fmm', 'pago'];
export const FMM_TIPOS = { fmm: 'FMM impresa', sello: 'Sello en pasaporte', qr: 'QR de internación' };
export const PAISES_FREC = ['USA', 'CAN', 'GBR', 'DEU', 'FRA', 'ESP', 'ITA', 'NLD', 'BRA', 'ARG', 'COL'];
export const PAISES = [['Afganistán','AFG'],['Albania','ALB'],['Alemania','DEU'],['Andorra','AND'],['Angola','AGO'],['Antigua y Barbuda','ATG'],['Arabia Saudita','SAU'],['Argelia','DZA'],['Argentina','ARG'],['Armenia','ARM'],['Australia','AUS'],['Austria','AUT'],['Azerbaiyán','AZE'],['Bahamas','BHS'],['Bangladés','BGD'],['Barbados','BRB'],['Baréin','BHR'],['Bélgica','BEL'],['Belice','BLZ'],['Benín','BEN'],['Bielorrusia','BLR'],['Bolivia','BOL'],['Bosnia y Herzegovina','BIH'],['Botsuana','BWA'],['Brasil','BRA'],['Brunéi','BRN'],['Bulgaria','BGR'],['Burkina Faso','BFA'],['Burundi','BDI'],['Bután','BTN'],['Cabo Verde','CPV'],['Camboya','KHM'],['Camerún','CMR'],['Canadá','CAN'],['Catar','QAT'],['Chad','TCD'],['Chile','CHL'],['China','CHN'],['Chipre','CYP'],['Colombia','COL'],['Comoras','COM'],['Corea del Norte','PRK'],['Corea del Sur','KOR'],['Costa de Marfil','CIV'],['Costa Rica','CRI'],['Croacia','HRV'],['Cuba','CUB'],['Dinamarca','DNK'],['Dominica','DMA'],['Ecuador','ECU'],['Egipto','EGY'],['El Salvador','SLV'],['Emiratos Árabes Unidos','ARE'],['Eritrea','ERI'],['Eslovaquia','SVK'],['Eslovenia','SVN'],['España','ESP'],['Estados Unidos','USA'],['Estonia','EST'],['Esuatini','SWZ'],['Etiopía','ETH'],['Filipinas','PHL'],['Finlandia','FIN'],['Fiyi','FJI'],['Francia','FRA'],['Gabón','GAB'],['Gambia','GMB'],['Georgia','GEO'],['Ghana','GHA'],['Granada','GRD'],['Grecia','GRC'],['Guatemala','GTM'],['Guinea','GIN'],['Guinea Ecuatorial','GNQ'],['Guinea-Bisáu','GNB'],['Guyana','GUY'],['Haití','HTI'],['Honduras','HND'],['Hungría','HUN'],['India','IND'],['Indonesia','IDN'],['Irak','IRQ'],['Irán','IRN'],['Irlanda','IRL'],['Islandia','ISL'],['Islas Marshall','MHL'],['Islas Salomón','SLB'],['Israel','ISR'],['Italia','ITA'],['Jamaica','JAM'],['Japón','JPN'],['Jordania','JOR'],['Kazajistán','KAZ'],['Kenia','KEN'],['Kirguistán','KGZ'],['Kiribati','KIR'],['Kuwait','KWT'],['Laos','LAO'],['Lesoto','LSO'],['Letonia','LVA'],['Líbano','LBN'],['Liberia','LBR'],['Libia','LBY'],['Liechtenstein','LIE'],['Lituania','LTU'],['Luxemburgo','LUX'],['Macedonia del Norte','MKD'],['Madagascar','MDG'],['Malasia','MYS'],['Malaui','MWI'],['Maldivas','MDV'],['Malí','MLI'],['Malta','MLT'],['Marruecos','MAR'],['Mauricio','MUS'],['Mauritania','MRT'],['México','MEX'],['Micronesia','FSM'],['Moldavia','MDA'],['Mónaco','MCO'],['Mongolia','MNG'],['Montenegro','MNE'],['Mozambique','MOZ'],['Myanmar','MMR'],['Namibia','NAM'],['Nauru','NRU'],['Nepal','NPL'],['Nicaragua','NIC'],['Níger','NER'],['Nigeria','NGA'],['Noruega','NOR'],['Nueva Zelanda','NZL'],['Omán','OMN'],['Países Bajos','NLD'],['Pakistán','PAK'],['Palaos','PLW'],['Panamá','PAN'],['Papúa Nueva Guinea','PNG'],['Paraguay','PRY'],['Perú','PER'],['Polonia','POL'],['Portugal','PRT'],['Reino Unido','GBR'],['República Centroafricana','CAF'],['República Checa','CZE'],['República del Congo','COG'],['República Democrática del Congo','COD'],['República Dominicana','DOM'],['Ruanda','RWA'],['Rumania','ROU'],['Rusia','RUS'],['Samoa','WSM'],['San Cristóbal y Nieves','KNA'],['San Marino','SMR'],['San Vicente y las Granadinas','VCT'],['Santa Lucía','LCA'],['Santo Tomé y Príncipe','STP'],['Senegal','SEN'],['Serbia','SRB'],['Seychelles','SYC'],['Sierra Leona','SLE'],['Singapur','SGP'],['Siria','SYR'],['Somalia','SOM'],['Sri Lanka','LKA'],['Sudáfrica','ZAF'],['Sudán','SDN'],['Sudán del Sur','SSD'],['Suecia','SWE'],['Suiza','CHE'],['Surinam','SUR'],['Tailandia','THA'],['Taiwán','TWN'],['Tanzania','TZA'],['Tayikistán','TJK'],['Timor Oriental','TLS'],['Togo','TGO'],['Tonga','TON'],['Trinidad y Tobago','TTO'],['Túnez','TUN'],['Turkmenistán','TKM'],['Turquía','TUR'],['Tuvalu','TUV'],['Ucrania','UKR'],['Uganda','UGA'],['Uruguay','URY'],['Uzbekistán','UZB'],['Vanuatu','VUT'],['Vaticano','VAT'],['Venezuela','VEN'],['Vietnam','VNM'],['Yemen','YEM'],['Yibuti','DJI'],['Zambia','ZMB'],['Zimbabue','ZWE']];

// Motivos sugeridos por acción. Siempre se puede escribir otro.
export const MOTIVOS = {
  recaptura: { t: 'Pedir que se vuelva a capturar', btn: 'Pedir recaptura', list: ['Foto borrosa o ilegible', 'Documento cortado o incompleto', 'Reflejo sobre los datos', 'Falta un documento'] },
  no_aplica: { t: 'Marcar como No aplica', btn: 'Marcar No aplica', list: ['Nacionalidad mexicana', 'No pertenece al grupo', 'Llegó fuera del periodo del grupo (±1 día)', 'Documentos entregados después de la salida del grupo'] },
  devolver_grupos: { t: 'Devolver a Grupos', btn: 'Devolver a Grupos', list: ['El nombre no coincide entre documentos', 'El comprobante no está a nombre del huésped', 'La firma no coincide', 'Se ven más de 4 dígitos de la tarjeta'] },
  devolver_credito: { t: 'Devolver a Crédito', btn: 'Devolver a Crédito', list: ['Registration card sin firma del huésped', 'Falta la forma migratoria', 'El nombre no coincide entre documentos', 'La nacionalidad no coincide'] },
  reabrir: { t: 'Reabrir por auditoría', btn: 'Reabrir expediente', list: ['Revisión de auditoría interna', 'Aclaración solicitada por la autoridad', 'Corrección de un documento'] },
};

// Verificaciones que cada área marca antes de pasar el expediente.
export const CHECKS = {
  grupos: ['El nombre coincide en pasaporte y registration card', 'La firma de la registration card coincide con la del pasaporte', 'La nacionalidad no es mexicana', 'La estancia está dentro de las noches del grupo (±1 día)'],
  credito: ['El comprobante de pago está a nombre del huésped', 'Solo se ven los últimos 4 dígitos de la tarjeta', 'El nombre del huésped coincide con su pasaporte'],
  impuestos: ['Los documentos están en el orden del archivo físico', 'Todos los documentos se leen completos', 'La forma migratoria muestra fecha de entrada'],
};
