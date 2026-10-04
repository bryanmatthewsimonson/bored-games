/*
 * NIP-44 v2 against the official test vectors (https://github.com/paulmillr/nip44, nip44.vectors.json), whose
 * SHA-256 NIP-44 publishes, plus RFC 8439's ChaCha20 block test.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  calcPaddedLen,
  chacha20,
  getConversationKey,
  getMessageKeys,
  isNip44Payload,
  nip44Decrypt,
  nip44Encrypt,
  utf8Decode,
} from '../src/nip44.ts';
import { getPublicKey } from '../src/nostr.ts';

const raw = readFileSync(new URL('./vectors/nip44.vectors.json', import.meta.url));
const V = JSON.parse(raw.toString('utf8')).v2;
const sha = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');

describe('NIP-44 v2 official vectors', () => {
  it('the vectors file is the published one (NIP-44 lists its SHA-256)', () => {
    expect(sha(raw)).toBe('269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040');
  });

  it('get_conversation_key', () => {
    for (const v of V.valid.get_conversation_key)
      expect(bytesToHex(getConversationKey(hexToBytes(v.sec1), v.pub2))).toBe(v.conversation_key);
  });

  it('get_message_keys', () => {
    const ck = hexToBytes(V.valid.get_message_keys.conversation_key);
    for (const v of V.valid.get_message_keys.keys) {
      const k = getMessageKeys(ck, hexToBytes(v.nonce));
      expect(bytesToHex(k.chachaKey)).toBe(v.chacha_key);
      expect(bytesToHex(k.chachaNonce)).toBe(v.chacha_nonce);
      expect(bytesToHex(k.hmacKey)).toBe(v.hmac_key);
    }
  });

  it('calc_padded_len', () => {
    for (const [len, padded] of V.valid.calc_padded_len) expect(calcPaddedLen(len)).toBe(padded);
  });

  it('encrypt_decrypt', () => {
    for (const v of V.valid.encrypt_decrypt) {
      const sec1 = hexToBytes(v.sec1);
      const sec2 = hexToBytes(v.sec2);
      const ck = getConversationKey(sec1, getPublicKey(sec2));
      expect(bytesToHex(ck)).toBe(v.conversation_key);
      // Symmetric: the other side derives the same key.
      expect(bytesToHex(getConversationKey(sec2, getPublicKey(sec1)))).toBe(v.conversation_key);
      expect(nip44Encrypt(v.plaintext, ck, hexToBytes(v.nonce))).toBe(v.payload);
      expect(nip44Decrypt(v.payload, ck)).toBe(v.plaintext);
    }
  });

  it('encrypt_decrypt_long_msg', () => {
    for (const v of V.valid.encrypt_decrypt_long_msg) {
      const plaintext = v.pattern.repeat(v.repeat);
      expect(sha(plaintext)).toBe(v.plaintext_sha256);
      const ck = hexToBytes(v.conversation_key);
      const payload = nip44Encrypt(plaintext, ck, hexToBytes(v.nonce));
      expect(sha(payload)).toBe(v.payload_sha256);
      expect(nip44Decrypt(payload, ck)).toBe(plaintext);
    }
  });

  it('invalid encrypt_msg_lengths', () => {
    const ck = new Uint8Array(32).fill(1);
    const nonce = new Uint8Array(32).fill(2);
    for (const len of V.invalid.encrypt_msg_lengths)
      expect(() => nip44Encrypt('a'.repeat(len), ck, nonce)).toThrow();
  });

  it('invalid get_conversation_key', () => {
    for (const v of V.invalid.get_conversation_key)
      expect(() => getConversationKey(hexToBytes(v.sec1), v.pub2), v.note).toThrow();
  });

  it('invalid decrypt', () => {
    for (const v of V.invalid.decrypt)
      expect(() => nip44Decrypt(v.payload, hexToBytes(v.conversation_key)), v.note).toThrow();
  });
});

describe('isNip44Payload (review L2)', () => {
  it('accepts exactly a v2 payload of that plaintext length', () => {
    for (const v of V.valid.encrypt_decrypt) {
      const n = new TextEncoder().encode(v.plaintext).length;
      expect(isNip44Payload(v.payload, n)).toBe(true);
      expect(isNip44Payload(v.payload, n + calcPaddedLen(n))).toBe(false);
    }
    const ck = new Uint8Array(32).fill(1);
    const text = '{"session":"' + 'ab'.repeat(32) + '"}';
    const payload = nip44Encrypt(text, ck, new Uint8Array(32).fill(2));
    expect(isNip44Payload(payload, text.length)).toBe(true);
    expect(isNip44Payload(text, text.length)).toBe(false); // plaintext handed back
    expect(isNip44Payload(`#${payload.slice(1)}`, text.length)).toBe(false);
    expect(isNip44Payload(payload.slice(0, -4), text.length)).toBe(false);
    expect(isNip44Payload(`Aw${payload.slice(2)}`, text.length)).toBe(false); // version 3
    expect(isNip44Payload(null, text.length)).toBe(false);
  });
});

describe('NIP-44 building blocks', () => {
  it('ChaCha20 matches RFC 8439 §2.4.2 (the sunscreen test)', () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i);
    const nonce = hexToBytes('000000000000004a00000000');
    const text =
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
    const out = chacha20(key, nonce, new TextEncoder().encode(text), 1);
    expect(bytesToHex(out)).toBe(
      '6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0bf91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d807ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab77937365af90bbf74a35be6b40b8eedf2785e42874d',
    );
  });

  it('base64 round-trips and refuses non-canonical text', () => {
    for (let n = 0; n < 10; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(base64Decode(base64Encode(b))).toEqual(b);
      expect(base64Encode(b)).toBe(Buffer.from(b).toString('base64'));
    }
    expect(() => base64Decode('QQ=')).toThrow();
    expect(() => base64Decode('QR==')).toThrow(); // stray bits under the padding
    expect(() => base64Decode('Q!==')).toThrow();
  });

  it('strict UTF-8 decoding', () => {
    expect(utf8Decode(new TextEncoder().encode('héllo 🎲'))).toBe('héllo 🎲');
    expect(() => utf8Decode(Uint8Array.from([0xc0, 0x80]))).toThrow(); // overlong
    expect(() => utf8Decode(Uint8Array.from([0xed, 0xa0, 0x80]))).toThrow(); // surrogate
    expect(() => utf8Decode(Uint8Array.from([0xe2, 0x82]))).toThrow(); // truncated
    expect(() => utf8Decode(Uint8Array.from([0x80]))).toThrow(); // stray continuation
  });
});
