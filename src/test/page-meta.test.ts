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

  it('has absolute Open Graph / Twitter preview tags that point at a real image of the right size', () => {
    const content = (attr: string, key: string) =>
      new RegExp(`<meta[^>]*${attr}="${key}"[^>]*content="([^"]*)"`).exec(html)?.[1];

    const image = content('property', 'og:image');
    expect(image).toMatch(/^https:\/\/financial-analyst-mcp\.vercel\.app\/og-image\.png$/);
    expect(content('name', 'twitter:image')).toBe(image);
    expect(content('property', 'og:url')).toBe('https://financial-analyst-mcp.vercel.app/');
    expect(content('name', 'twitter:card')).toBe('summary_large_image');
    expect(content('property', 'og:image:width')).toBe('1200');
    expect(content('property', 'og:image:height')).toBe('630');

    // PNG header: width/height live at bytes 16-23 of the IHDR chunk.
    const png = readFileSync(resolve(root, 'public/og-image.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
