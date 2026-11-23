import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AVISO_VERSION, avisoHTML } from '../src/client/aviso.js';

describe('aviso de privacidad', () => {
  it('la versión de la página y la del servidor coinciden', () => {
    const worker = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8');
    expect(worker).toContain(`const AVISO_VERSION = '${AVISO_VERSION}';`);
  });
  it('resalta lo pendiente y escapa el texto', () => {
    const esc = (s) => s.replace(/</g, '&lt;');
    expect(avisoHTML('a <b> {{x}}', esc)).toBe('a &lt;b> <mark class="pend">x</mark>');
  });
});
