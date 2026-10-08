import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The saved theme is applied before first paint by public/theme-init.js (loaded synchronously from
// index.html) so dark-mode users don't see a white flash on reload — ThemeToggle only sets the class
// from a post-paint effect. It is a separate file, not inline, because vercel.json's CSP is
// `script-src 'self'`, which blocks inline scripts. These tests run the real file against jsdom.
const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
const initScript = readFileSync(resolve(__dirname, '../../public/theme-init.js'), 'utf-8');
const csp = JSON.parse(readFileSync(resolve(__dirname, '../../vercel.json'), 'utf-8')).headers[0].headers.find(
  (h: { key: string }) => h.key === 'Content-Security-Policy',
).value as string;

const runInitScript = () => new Function(initScript)();

describe('theme init script', () => {
  beforeEach(() => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#ffffff">');
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it('is loaded as a same-origin script in <head>, before the app module — and not inline', () => {
    expect(html).toMatch(/<script src="\/theme-init\.js"><\/script>/);
    expect(html.indexOf('/theme-init.js')).toBeLessThan(html.indexOf('type="module"'));
    // Any <script> without a src would be an inline script, which the CSP blocks.
    expect(html.match(/<script(?![^>]*\ssrc=)[^>]*>/g)).toBeNull();
  });

  it('is permitted by the deployed CSP (script-src is self-only, no unsafe-inline)', () => {
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(/script-src[^;]*'unsafe-inline'/.test(csp)).toBe(false);
  });

  it('adds the dark class and dark theme-color when the saved theme is dark', () => {
    localStorage.setItem('theme', 'dark');
    runInitScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#090e1b');
  });

  it('leaves the page light for a light or missing saved theme', () => {
    runInitScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    localStorage.setItem('theme', 'light');
    runInitScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#ffffff');
  });

  it('does not throw when localStorage is unavailable', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(runInitScript).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
