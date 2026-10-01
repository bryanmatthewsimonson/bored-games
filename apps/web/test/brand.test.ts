import { BRAND } from '@bored-games/brand';
import { describe, expect, it } from 'vitest';
import manifestText from '../public/manifest.webmanifest?raw';

describe('web manifest', () => {
  it('uses the platform name from the brand package', () => {
    const m = JSON.parse(manifestText) as { name: string; short_name: string; start_url: string };
    expect(m.name).toBe(BRAND.name);
    expect(m.short_name).toBe(BRAND.name);
    expect(m.start_url).toBe('./');
  });
});
