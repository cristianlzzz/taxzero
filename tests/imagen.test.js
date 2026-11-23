import { describe, expect, it } from 'vitest';
import { varianzaLaplaciano } from '../src/client/imagen.js';

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
