/*
 * Profile pictures in the browser: a photo or a preset becomes a 256×256 WebP (JPEG where WebP cannot be
 * encoded) of at most 100 KB. Drawing to a canvas and re-encoding drops all metadata (EXIF, GPS), and the
 * EXIF orientation is applied first (D040).
 */
import { type Preset, presetDataUrl } from './avatar-model.ts';

/** The largest photo accepted (bytes). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
/** The side of the uploaded square (px). */
export const AVATAR_SIZE = 256;
/** The largest upload (bytes). */
export const MAX_AVATAR_BYTES = 100 * 1024;
/** Encoder qualities tried in order until the picture fits. */
export const QUALITIES: readonly number[] = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.4];
export const AVATAR_TYPES = ['image/webp', 'image/jpeg'] as const;

export interface EncodedAvatar {
  bytes: Uint8Array;
  type: (typeof AVATAR_TYPES)[number];
}

/** The centered square of a `w`×`h` picture: its top-left corner and side. */
export function centerSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
}

export const PHOTO_ERRORS = {
  tooBig: 'That file is over 15 MB. Choose a smaller picture.',
  notImage: 'That file could not be read as a picture. Try a JPEG, PNG or WebP image.',
  noFit: 'Could not make this picture small enough. Try another one.',
} as const;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Encode the canvas as WebP, else JPEG, lowering the quality until it fits `MAX_AVATAR_BYTES`. */
async function encode(canvas: HTMLCanvasElement): Promise<EncodedAvatar> {
  for (const type of AVATAR_TYPES) {
    for (const q of QUALITIES) {
      const blob = await toBlob(canvas, type, q);
      // A browser that cannot encode the type falls back to PNG: try the next type.
      if (blob === null || blob.type !== type) break;
      if (blob.size <= MAX_AVATAR_BYTES) return { bytes: new Uint8Array(await blob.arrayBuffer()), type };
    }
  }
  throw new Error(PHOTO_ERRORS.noFit);
}

function square(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('This browser cannot draw pictures.');
  // JPEG has no transparency: transparent pixels become white rather than black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** A photo: oriented, center-cropped, scaled to 256×256 and re-encoded without its metadata. */
export async function photoToAvatar(file: Blob): Promise<EncodedAvatar> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error(PHOTO_ERRORS.tooBig);
  if (file.type !== '' && !file.type.startsWith('image/')) throw new Error(PHOTO_ERRORS.notImage);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(PHOTO_ERRORS.notImage);
  }
  try {
    const { canvas, ctx } = square();
    const { sx, sy, side } = centerSquare(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return await encode(canvas);
  } finally {
    bitmap.close();
  }
}

/** A gallery preset, rasterized the same way. */
export async function presetToAvatar(p: Preset): Promise<EncodedAvatar> {
  const img = new Image(AVATAR_SIZE, AVATAR_SIZE);
  img.src = presetDataUrl(p);
  await img.decode();
  const { canvas, ctx } = square();
  ctx.drawImage(img, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return encode(canvas);
}
