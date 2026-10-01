import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { centerSquare } from '../src/avatar-image.ts';
import { npubEncode, shortNpub } from '../src/bech32.ts';
import { Avatar, PlayerTagView } from '../src/components/avatar.tsx';
import { classOf, findAll, renderTree, spokenText } from './render-tree.ts';

const PK = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';

const imgs = (node: Parameters<typeof renderTree>[0]) => findAll(renderTree(node), (el) => el.tag === 'img');

describe('Avatar', () => {
  it('draws the pattern under a safe https picture, without a referrer, lazily, at a fixed size', () => {
    const tree = renderTree(
      h(Avatar, { pubkey: PK, picture: 'https://blossom.primal.net/a.webp', size: 32 }),
    );
    expect(findAll(tree, (el) => el.tag === 'svg')).toHaveLength(1);
    const [img] = imgs(h(Avatar, { pubkey: PK, picture: 'https://blossom.primal.net/a.webp', size: 32 }));
    expect(img?.attrs).toMatchObject({
      src: 'https://blossom.primal.net/a.webp',
      referrerPolicy: 'no-referrer',
      loading: 'lazy',
      width: 32,
      height: 32,
      alt: '',
    });
    expect(typeof img?.attrs.onError).toBe('function');
  });

  it('renders no <img> for http:, data: or unsafe pictures', () => {
    for (const picture of [
      'http://example.com/a.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'https://127.0.0.1/a.png',
      null,
    ])
      expect(imgs(h(Avatar, { pubkey: PK, picture })), String(picture)).toHaveLength(0);
  });

  it('is hidden from screen readers unless it has alt text', () => {
    const [plain] = renderTree(h(Avatar, { pubkey: PK, picture: null }));
    expect(plain && typeof plain !== 'string' && plain.attrs['aria-hidden']).toBe('true');
    const [named] = renderTree(h(Avatar, { pubkey: PK, picture: null, alt: 'Your picture' }));
    expect(named && typeof named !== 'string' && named.attrs).toMatchObject({
      role: 'img',
      'aria-label': 'Your picture',
    });
  });
});

describe('PlayerTagView', () => {
  it('shows the avatar, the name and always the short npub', () => {
    const tree = renderTree(
      h(PlayerTagView, {
        pubkey: PK,
        info: { name: 'Ann', about: null, picture: 'https://e.com/a.webp' },
        isMe: true,
      }),
    );
    expect(spokenText(tree)).toBe(`Ann ${shortNpub(npubEncode(PK))}you`);
    expect(findAll(tree, (el) => classOf(el).includes('avatar'))).toHaveLength(1);
    expect(findAll(tree, (el) => el.tag === 'img')).toHaveLength(1);
  });

  it('shows just the pattern and npub without a profile', () => {
    const tree = renderTree(h(PlayerTagView, { pubkey: PK, info: null }));
    expect(spokenText(tree)).toBe(shortNpub(npubEncode(PK)));
    expect(findAll(tree, (el) => el.tag === 'img')).toHaveLength(0);
  });
});

describe('centerSquare', () => {
  it('crops the middle of landscape and portrait pictures', () => {
    expect(centerSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 });
    expect(centerSquare(300, 401)).toEqual({ sx: 0, sy: 50, side: 300 });
    expect(centerSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });
});
