import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf-8');

describe('index.html brand meta', () => {
  it('declares theme-color and icons, and every referenced icon file exists in public/', () => {
    expect(html).toContain('name="theme-color"');
    for (const href of ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png']) {
      expect(html, href).toContain(`href="${href}"`);
      expect(existsSync(resolve(root, 'public', href.slice(1))), href).toBe(true);
    }
  });
});
