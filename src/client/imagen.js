// Procesa la foto tomada con la cámara del iPad: corrige la orientación, la reduce
// a un tamaño razonable (sin perder legibilidad) y mide qué tan nítida salió.

export const LADO_MAX = 2200; // px del lado largo: suficiente para leer pasaporte y firma
export const CALIDAD = 0.85;
// Por debajo de este valor la foto casi siempre está movida o desenfocada.
export const NITIDEZ_MIN = 60;

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
  const nitidez = medirNitidez(canvas);
  const blob = await new Promise((ok, mal) =>
    canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la foto.'))), 'image/jpeg', CALIDAD),
  );
  return { blob, ancho, alto, nitidez, url: URL.createObjectURL(blob) };
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

// Varianza del laplaciano sobre una copia pequeña en escala de grises.
// Más alto = bordes más definidos = texto más legible.
export function medirNitidez(origen) {
  const lado = 640;
  const s = Math.min(1, lado / Math.max(origen.width, origen.height));
  const w = Math.max(3, Math.round(origen.width * s));
  const h = Math.max(3, Math.round(origen.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(origen, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return varianzaLaplaciano(data, w, h);
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
