/*
 * End to end: names and pictures (D040). The Blossom server is intercepted (`/upload` and the blob URLs), so
 * the test checks exactly what the browser sends: the kind 24242 authorization, and a 256×256 picture of at
 * most 100 KB with no metadata left from the photo.
 *
 * - a uploads a photo carrying an EXIF block, saves a name, and creates a table;
 * - b picks a gallery picture, saves a name, and opens the table link;
 * - each sees the other's name, picture and short npub on the table seats.
 *
 * Run it with `pnpm e2e` (all specs) or `pnpm e2e profile.spec.ts`.
 */
import { createHash } from 'node:crypto';
import { type NostrEvent, verifyEvent } from '@bored-games/protocol';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';

const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:7777';
const BLOSSOM = 'https://blossom.primal.net';
const EXIF_MARKER = 'GPS-SECRET-PLACE-4471';

function appUrl(profile: string, from?: string): string {
  const u = new URL(from ?? process.env.E2E_BASE_URL ?? 'http://localhost:4173/');
  u.searchParams.set('profile', profile);
  if (RELAY !== 'none') u.searchParams.set('relays', RELAY);
  return u.toString();
}

interface Upload {
  auth: NostrEvent;
  headers: Record<string, string>;
  body: Buffer;
  sha256: string;
}

/** A fake Blossom server shared by every context: uploads are kept and served back by hash. */
function fakeBlossom() {
  const blobs = new Map<string, { body: Buffer; type: string }>();
  const uploads: Upload[] = [];
  const cors = { 'access-control-allow-origin': '*' };
  return {
    uploads,
    async attach(context: BrowserContext) {
      await context.route(`${BLOSSOM}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS')
          return route.fulfill({
            status: 204,
            headers: {
              ...cors,
              'access-control-allow-headers': 'Authorization, *',
              'access-control-allow-methods': 'GET, PUT, DELETE',
            },
          });
        if (req.method() === 'PUT' && path === '/upload') {
          const headers = await req.allHeaders();
          const body = req.postDataBuffer() ?? Buffer.alloc(0);
          const sha256 = createHash('sha256').update(body).digest('hex');
          const auth = JSON.parse(
            Buffer.from((headers.authorization ?? '').replace(/^Nostr /, ''), 'base64').toString('utf8'),
          ) as NostrEvent;
          uploads.push({ auth, headers, body, sha256 });
          const type = headers['content-type'] ?? 'application/octet-stream';
          blobs.set(sha256, { body, type });
          return route.fulfill({
            status: 200,
            headers: { ...cors, 'content-type': 'application/json' },
            body: JSON.stringify({ url: `${BLOSSOM}/${sha256}.webp`, sha256, size: body.length, type }),
          });
        }
        const blob = blobs.get(path.slice(1, 65));
        if (req.method() === 'GET' && blob !== undefined)
          return route.fulfill({
            status: 200,
            headers: { ...cors, 'content-type': blob.type },
            body: blob.body,
          });
        return route.fulfill({ status: 404, headers: cors });
      });
    },
  };
}

/** An APP1 Exif segment (big-endian TIFF) holding an ImageDescription with `text`, and orientation 6. */
function exifSegment(text: string): Buffer {
  const desc = Buffer.from(`${text}\0`, 'ascii');
  const entries = 2;
  const ifdSize = 2 + entries * 12 + 4;
  const tiff = Buffer.alloc(8 + ifdSize + desc.length);
  tiff.write('MM', 0, 'ascii');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(entries, 8);
  // 0x010e ImageDescription, ASCII, its bytes after the IFD.
  tiff.writeUInt16BE(0x010e, 10);
  tiff.writeUInt16BE(2, 12);
  tiff.writeUInt32BE(desc.length, 14);
  tiff.writeUInt32BE(8 + ifdSize, 18);
  // 0x0112 Orientation, SHORT, 6 (rotate 90° clockwise).
  tiff.writeUInt16BE(0x0112, 22);
  tiff.writeUInt16BE(3, 24);
  tiff.writeUInt32BE(1, 26);
  tiff.writeUInt16BE(6, 30);
  tiff.writeUInt32BE(0, 8 + 2 + entries * 12);
  desc.copy(tiff, 8 + ifdSize);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** A 600×400 JPEG drawn in the page, with an Exif block inserted after its SOI marker. */
async function photoWithExif(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 400;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 600, 400);
    g.addColorStop(0, '#d94f30');
    g.addColorStop(1, '#2f5fb3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 600, 400);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`;
      ctx.fillRect((i * 53) % 600, (i * 29) % 400, 9, 9);
    }
    return c.toDataURL('image/jpeg', 0.95);
  });
  const jpeg = Buffer.from(dataUrl.split(',')[1] as string, 'base64');
  expect(jpeg.readUInt16BE(0)).toBe(0xffd8);
  const out = Buffer.concat([jpeg.subarray(0, 2), exifSegment(EXIF_MARKER), jpeg.subarray(2)]);
  expect(out.includes(Buffer.from(EXIF_MARKER))).toBe(true);
  return out;
}

/** The pixel size of an image, decoded by the page. */
function imageSize(page: Page, bytes: Buffer, type: string): Promise<{ w: number; h: number }> {
  return page.evaluate(
    async ({ b64, type }) => {
      const bin = atob(b64);
      const arr = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([arr], { type }));
      return { w: bmp.width, h: bmp.height };
    },
    { b64: bytes.toString('base64'), type },
  );
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  return page.getByRole('dialog');
}

async function saveProfile(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Save name and picture' }).click();
  await expect(dialog.getByText(/^Saved\./)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
}

const seatOf = (page: Page, name: string) => page.locator('.seat-list .seat').filter({ hasText: name });

test('players set a name and picture, and see each other’s on the table seats', async ({ browser }) => {
  const blossom = fakeBlossom();
  const contexts: BrowserContext[] = [];
  const open = async (profile: string, url?: string) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    contexts.push(context);
    await blossom.attach(context);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(`[${profile}] page error: ${e.message}`));
    await page.goto(appUrl(profile, url));
    return page;
  };

  // a: no profile yet, so Home nudges; then a photo with EXIF, and a name.
  const a = await open('a');
  await expect(a.getByText('Add your name and picture so friends recognize you.')).toBeVisible();
  const dialog = await openSettings(a);
  await dialog.getByLabel('Name', { exact: true }).fill('Ann Example');
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: await photoWithExif(a),
  });
  await expect(dialog.getByText('Picture ready. Save to show it to other players.')).toBeVisible();
  expect(blossom.uploads).toHaveLength(1);
  const up = blossom.uploads[0] as Upload;

  // The authorization: a valid kind 24242 by a's key, for exactly this blob, expiring within minutes.
  expect(verifyEvent(up.auth)).toBe(true);
  expect(up.auth.kind).toBe(24242);
  expect(up.auth.tags).toContainEqual(['t', 'upload']);
  expect(up.auth.tags).toContainEqual(['x', up.sha256]);
  const exp = Number(up.auth.tags.find((t) => t[0] === 'expiration')?.[1]);
  expect(exp - up.auth.created_at).toBe(300);
  expect(up.headers['content-type']).toMatch(/^image\/(webp|jpeg)$/);
  // The picture: 256×256, at most 100 KB, and nothing left of the photo's EXIF.
  expect(up.body.length).toBeLessThanOrEqual(100 * 1024);
  expect(up.body.includes(Buffer.from(EXIF_MARKER))).toBe(false);
  expect(up.body.includes(Buffer.from('Exif\0\0', 'binary'))).toBe(false);
  expect(await imageSize(a, up.body, up.headers['content-type'] as string)).toEqual({ w: 256, h: 256 });
  await expect(dialog.getByRole('img', { name: 'Your picture' }).locator('img')).toHaveAttribute(
    'src',
    `${BLOSSOM}/${up.sha256}.webp`,
  );
  await saveProfile(a);
  const aKey = await a.locator('.identity .npub').innerText();
  await expect(a.locator('.identity')).toContainText('Ann Example');
  await expect(a.getByText('Add your name and picture so friends recognize you.')).toHaveCount(0);

  await a.getByRole('button', { name: 'Create table' }).click();
  await expect(a).toHaveURL(/#\/t\/[0-9a-f]{64}\//);
  const share = await a.getByLabel('Table link').inputValue();

  // b: a gallery picture (uploaded the same way) and a name, then the table link.
  const b = await open('b');
  const bDialog = await openSettings(b);
  await bDialog.getByLabel('Name', { exact: true }).fill('Bo Tester');
  await bDialog.locator('label.seg', { hasText: 'Gallery' }).click();
  await expect(bDialog.getByRole('radio', { name: 'Gallery' })).toBeChecked();
  await bDialog.getByRole('button', { name: 'Owl' }).click();
  await expect(bDialog.getByText('Picture ready. Save to show it to other players.')).toBeVisible();
  expect(blossom.uploads).toHaveLength(2);
  const owl = blossom.uploads[1] as Upload;
  expect(verifyEvent(owl.auth)).toBe(true);
  expect(owl.auth.pubkey).not.toBe(up.auth.pubkey);
  expect(await imageSize(b, owl.body, owl.headers['content-type'] as string)).toEqual({ w: 256, h: 256 });
  await saveProfile(b);
  const bKey = await b.locator('.identity .npub').innerText();
  await b.goto(appUrl('b', share));

  // b sees a's seat: name, picture and short npub.
  const annSeat = seatOf(b, 'Ann Example');
  await expect(annSeat).toBeVisible();
  await expect(annSeat.locator('.npub')).toHaveText(aKey);
  await expect(annSeat.locator('.avatar img')).toHaveAttribute('src', `${BLOSSOM}/${up.sha256}.webp`);
  await expect(annSeat.locator('.avatar img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect
    .poll(() => annSeat.locator('.avatar img').evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBe(256);

  // b joins, and a sees b's seat the same way.
  await b.getByRole('button', { name: 'Join this table' }).click();
  await expect(b.getByText('You are seated.')).toBeVisible();
  const boSeat = seatOf(a, 'Bo Tester');
  await expect(boSeat).toBeVisible();
  await expect(boSeat.locator('.npub')).toHaveText(bKey);
  await expect(boSeat.locator('.avatar img')).toHaveAttribute('src', `${BLOSSOM}/${owl.sha256}.webp`);

  for (const c of contexts) await c.close();
});
