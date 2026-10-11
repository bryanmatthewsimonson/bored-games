import { readFileSync } from 'node:fs';
import { BRAND } from '@bored-games/brand';
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import manifestText from '../public/manifest.webmanifest?raw';

function pngSize(src: string): string {
  const bytes = readFileSync(new URL(src, new URL('../public/manifest.webmanifest', import.meta.url)));
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('web manifest', () => {
  it('uses the platform name from the brand package', () => {
    const m = JSON.parse(manifestText) as { name: string; short_name: string; start_url: string };
    expect(m.name).toBe(BRAND.name);
    expect(m.short_name).toBe(BRAND.name);
    expect(m.start_url).toBe('./');
  });

  it('ships correctly sized PNG icons for ordinary and maskable Android launchers', () => {
    const m = JSON.parse(manifestText) as {
      icons: { src: string; sizes: string; type: string; purpose: string }[];
    };
    expect(m.icons.filter((icon) => icon.purpose === 'any').map((icon) => icon.sizes)).toEqual([
      '192x192',
      '512x512',
    ]);
    expect(m.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of m.icons) {
      expect(icon.src.startsWith('./')).toBe(true);
      expect(icon.type).toBe('image/png');
      expect(pngSize(icon.src)).toBe(icon.sizes);
    }
  });

  it('ships a 180px Apple touch icon and the platform home-screen title', () => {
    const link = indexHtml.match(/<link\b[^>]*rel="apple-touch-icon"[^>]*>/)?.[0];
    const src = link?.match(/href="([^"]+)"/)?.[1];
    expect(src).toBeDefined();
    if (src === undefined) throw new Error('Missing Apple touch icon');
    expect(pngSize(src)).toBe('180x180');
    expect(indexHtml).toContain(`<meta name="apple-mobile-web-app-title" content="${BRAND.name}"`);
  });
});
