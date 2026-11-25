// Procesa la foto tomada con la cámara del iPad: corrige la orientación, la reduce
// a un tamaño razonable (sin perder legibilidad) y revisa su calidad (borrosa, oscura,
// con reflejo o cortada) para avisar antes de guardarla. Todo se hace en el iPad.

export const LADO_MAX = 2200; // px del lado largo: suficiente para leer pasaporte y firma
export const CALIDAD = 0.85;

export async function procesarFoto(file) {
  const bmp = await cargar(file);
  const escala = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
  const ancho = Math.round(bmp.width * escala);
  const alto = Math.round(bmp.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, ancho, alto);
  if (bmp.close) bmp.close();
  const calidad = revisarFoto(canvas);
  const blob = await new Promise((ok, mal) =>
    canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la foto.'))), 'image/jpeg', CALIDAD),
  );
  return { blob, ancho, alto, nitidez: calidad.nitidez, problemas: calidad.problemas, url: URL.createObjectURL(blob) };
}

async function cargar(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* Safari antiguo: se usa <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// La revisión se hace sobre una copia pequeña: es rápida y basta para estas medidas.
function copiaChica(origen) {
  const lado = 1280;
  const s = Math.min(1, lado / Math.max(origen.width, origen.height));
  const w = Math.max(3, Math.round(origen.width * s));
  const h = Math.max(3, Math.round(origen.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(origen, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

export function revisarFoto(origen) {
  const { data, w, h } = copiaChica(origen);
  return evaluarCalidad(data, w, h);
}

// Umbrales calibrados con fotos de documentos de prueba (nítidas y degradadas a propósito).
export const UMBRAL = {
  nitidez: 90, // por debajo, las letras chicas ya no se leen: movida o desenfocada
  oscura: 105, // brillo del papel (percentil 75) por debajo de esto: falta luz
  reflejo: 0.005, // fracción de la foto quemada en blanco, claramente más brillante que el papel
  orilla: 0.05, // fracción de una orilla con trazos fuertes (texto o líneas que se salen de la foto)
  hojaToca: 0.4, // el documento ocupa buena parte de una orilla…
  hojaFuera: 0.1, // …mientras otra orilla muestra solo la mesa
};

export const PROBLEMAS = {
  borrosa: ['Salió borrosa', 'Sostén el iPad firme y espera a que enfoque antes de tomarla.'],
  oscura: ['Salió oscura', 'Busca más luz o acerca el documento a una lámpara.'],
  reflejo: ['Tiene un reflejo', 'Inclina un poco el documento o el iPad para quitar el brillo.'],
  cortada: ['Puede estar cortada', 'Aleja un poco el iPad para que se vean las cuatro orillas del documento.'],
};

// Devuelve las medidas y la lista de problemas encontrados (vacía si la foto está bien).
export function evaluarCalidad(rgba, w, h) {
  const n = w * h;
  const g = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const v = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    g[i] = v;
    hist[Math.min(255, Math.round(v))]++;
  }
  const percentil = (p) => {
    const meta = n * p;
    let acum = 0;
    for (let v = 0; v < 256; v++) {
      acum += hist[v];
      if (acum >= meta) return v;
    }
    return 255;
  };
  const papel = percentil(0.75);
  const nitidez = nitidezSuavizada(g, w, h);

  // Reflejo: zona quemada (casi blanco puro) que destaca sobre el papel. Si el papel
  // ya es blanco puro (documento muy claro), no se considera reflejo.
  let quemados = 0;
  if (papel < 236) for (let v = 250; v < 256; v++) quemados += hist[v];
  const reflejo = quemados / n;

  // Cortada: texto o líneas que llegan hasta la orilla, o el documento tocando una
  // orilla mientras en otra se ve la mesa.
  const franja = Math.max(2, Math.round(Math.min(w, h) * 0.015));
  const medir = (x0, x1, y0, y1) => {
    let trazos = 0;
    let hoja = 0;
    let t = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const gx = x + 1 < w ? Math.abs(g[i + 1] - g[i]) : 0;
        const gy = y + 1 < h ? Math.abs(g[i + w] - g[i]) : 0;
        t++;
        if (gx + gy > 60) trazos++;
        if (g[i] >= papel - 18) hoja++;
      }
    }
    return { trazos: trazos / t, hoja: hoja / t };
  };
  const lados = [medir(0, w, 0, franja), medir(0, w, h - franja, h), medir(0, franja, 0, h), medir(w - franja, w, 0, h)];
  const orilla = Math.max(...lados.map((l) => l.trazos));
  const hojaMax = Math.max(...lados.map((l) => l.hoja));
  const hojaMin = Math.min(...lados.map((l) => l.hoja));

  const problemas = [];
  if (nitidez < UMBRAL.nitidez) problemas.push('borrosa');
  if (papel < UMBRAL.oscura) problemas.push('oscura');
  if (reflejo > UMBRAL.reflejo) problemas.push('reflejo');
  if (orilla > UMBRAL.orilla || (hojaMax > UMBRAL.hojaToca && hojaMin < UMBRAL.hojaFuera)) problemas.push('cortada');
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { nitidez, papel, reflejo: r3(reflejo), orilla: r3(orilla), hojaMax: r3(hojaMax), hojaMin: r3(hojaMin), problemas };
}

// Nitidez sobre una copia suavizada 2x2: el grano de la cámara se cancela y quedan
// solo los bordes reales del texto. Más alto = letras más definidas.
function nitidezSuavizada(g, w, h) {
  const w2 = w >> 1;
  const h2 = h >> 1;
  if (w2 < 3 || h2 < 3) return 0;
  const m = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      m[y * w2 + x] = (g[i] + g[i + 1] + g[i + w] + g[i + w + 1]) / 4;
    }
  }
  let suma = 0;
  let suma2 = 0;
  let k = 0;
  for (let y = 1; y < h2 - 1; y++) {
    for (let x = 1; x < w2 - 1; x++) {
      const i = y * w2 + x;
      const l = m[i - w2] + m[i + w2] + m[i - 1] + m[i + 1] - 4 * m[i];
      suma += l;
      suma2 += l * l;
      k++;
    }
  }
  return Math.round((suma2 / k - (suma / k) ** 2) * 10) / 10;
}

export function varianzaLaplaciano(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  let suma = 0;
  let suma2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
      suma += l;
      suma2 += l * l;
      n++;
    }
  }
  if (!n) return 0;
  const media = suma / n;
  return Math.round((suma2 / n - media * media) * 10) / 10;
}
