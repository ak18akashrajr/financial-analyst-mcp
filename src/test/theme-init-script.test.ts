import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// index.html carries a tiny inline script that applies the saved theme before first paint (so
// dark-mode users don't see a white flash on reload — ThemeToggle only sets the class from a
// post-paint effect). This runs that exact script against jsdom's localStorage/documentElement.
const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

const runInitScript = () => new Function(inlineScript as string)();

describe('index.html theme init script', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('is present inline in <head>, before the app module script', () => {
    expect(inlineScript).toBeDefined();
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
  });

  it('adds the dark class when the saved theme is dark', () => {
    localStorage.setItem('theme', 'dark');
    runInitScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('leaves the page light for a light or missing saved theme', () => {
    runInitScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    localStorage.setItem('theme', 'light');
    runInitScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
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
