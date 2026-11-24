import { describe, expect, it } from 'vitest';
import { evaluarCalidad, varianzaLaplaciano } from '../src/client/imagen.js';

function imagen(w, h, f) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = f(x, y);
    const i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  return d;
}

describe('nitidez de la foto', () => {
  it('una imagen lisa no tiene nitidez', () => {
    expect(varianzaLaplaciano(imagen(50, 50, () => 128), 50, 50)).toBe(0);
  });
  it('bordes definidos (texto) dan más nitidez que un degradado suave', () => {
    const texto = varianzaLaplaciano(imagen(80, 80, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 20 : 235), 80, 80);
    const borrosa = varianzaLaplaciano(imagen(80, 80, (x) => 100 + Math.round(30 * Math.sin(x / 12))), 80, 80);
    expect(texto).toBeGreaterThan(1000);
    expect(borrosa).toBeLessThan(5);
  });
});

// Documento sintético: hoja clara con renglones de "texto" sobre una mesa más oscura.
function documento(w, h, { margen = 0.12, papel = 215, mesa = 120, tinta = 30, quemado = 0, corte = null } = {}) {
  const x0 = Math.round(w * margen);
  const y0 = Math.round(h * margen);
  const x1 = corte === 'derecha' ? w + 50 : w - x0;
  const y1 = h - y0;
  const d = new Uint8ClampedArray(w * h * 4);
  const cx = w * 0.55;
  const cy = h * 0.45;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = mesa;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        const renglon = (y - y0) % 14 < 6 && (x - x0) % 9 < 6 && x > x0 + 10 && y > y0 + 10;
        v = renglon ? tinta : papel;
        if (quemado && Math.hypot(x - cx, y - cy) < quemado) v = 255;
      }
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return d;
}

function suavizar(rgba, w, h, r) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx));
      const yy = Math.min(h - 1, Math.max(0, y + dy));
      s += rgba[(yy * w + xx) * 4];
      n++;
    }
    const i = (y * w + x) * 4;
    out[i] = out[i + 1] = out[i + 2] = s / n;
    out[i + 3] = 255;
  }
  return out;
}

describe('revisión de calidad de la foto', () => {
  const W = 400;
  const H = 280;
  it('una foto buena no tiene avisos', () => {
    expect(evaluarCalidad(documento(W, H), W, H).problemas).toEqual([]);
  });
  it('detecta una foto borrosa (las letras se funden)', () => {
    const r = evaluarCalidad(suavizar(documento(W, H), W, H, 7), W, H);
    expect(r.problemas).toContain('borrosa');
  });
  it('detecta una foto oscura', () => {
    expect(evaluarCalidad(documento(W, H, { papel: 80, mesa: 40, tinta: 10 }), W, H).problemas).toEqual(['oscura']);
  });
  it('detecta un reflejo sobre el documento', () => {
    expect(evaluarCalidad(documento(W, H, { quemado: 30 }), W, H).problemas).toEqual(['reflejo']);
  });
  it('un documento blanco puro no se confunde con reflejo', () => {
    expect(evaluarCalidad(documento(W, H, { papel: 255 }), W, H).problemas).toEqual([]);
  });
  it('detecta un documento cortado', () => {
    expect(evaluarCalidad(documento(W, H, { corte: 'derecha' }), W, H).problemas).toEqual(['cortada']);
  });
});
