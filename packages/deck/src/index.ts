/*
 * Public API of @bored-games/deck. The verifiers check `instanceof` against this package's own @noble/curves copy
 * and return false for a point built by another copy (D023): take points from `decodePoint` or from this package.
 */
export {
  makeMoveRollShare,
  makeRollShare,
  moveRollCiphertext,
  moveRollPoint,
  ROLL_DECK,
  rollCiphertext,
  rollPoint,
  rollSeed,
  verifyMoveRollShare,
  verifyRollShare,
} from './beacon.ts';
export { cardOf, cardPoint, cardTable } from './cards.ts';
export {
  combine,
  decryptPosition,
  makeShare,
  ownShare,
  type Share,
  type ShareCtx,
  type SharesBySeat,
  verifyShare,
} from './dleq.ts';
export { type Ciphertext, decryptWithSecrets, initialDeck, jointKey, reEncrypt } from './elgamal.ts';
export {
  b64u,
  decodePoint,
  decodeScalar,
  encodePoint,
  encodeScalar,
  hs,
  type Part,
  type Point,
} from './encoding.ts';
export { G, generators, h2c, q } from './group.ts';
export { type PokProof, provePok, verifyPok } from './pok.ts';
export { type RandomBytes, randomScalar } from './random.ts';
// Sealed shares: reference implementation, not used by the session or the protocol yet (D055).
export {
  openAndVerify,
  proveOpening,
  type SealedOpening,
  type SealedShare,
  sealShare,
  verifyOpening,
  verifySealedShare,
} from './sealed.ts';
export { proveShuffle, type ShuffleCtx, type ShuffleProof, shuffleDeck, verifyShuffle } from './shuffle.ts';
export {
  type DeckWire,
  DeckWireError,
  decodeDeck,
  decodePok,
  decodeSealedOpening,
  decodeSealedShare,
  decodeShare,
  decodeShuffleProof,
  encodeDeck,
  encodePok,
  encodeSealedOpening,
  encodeSealedShare,
  encodeShare,
  encodeShuffleProof,
  type PokWire,
  type SealedOpeningWire,
  type SealedShareWire,
  type ShareWire,
  type ShuffleProofWire,
} from './wire.ts';
