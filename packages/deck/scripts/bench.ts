/**
 * pnpm --filter @bored-games/deck bench
 *
 * Cost profile of one 108-card shuffle step and of decryption shares. Uses the platform CSPRNG, as production
 * will. The measured step is seat 1's (its input is seat 0's output), the common case: seat 0's input is the
 * initial deck, whose identity `a` components make its verification a little cheaper.
 */
import { randomBytes } from 'node:crypto';
import { canonicalJson } from '@bored-games/game-kit';
import {
  type Ciphertext,
  cardTable,
  encodeDeck,
  encodePok,
  encodeShare,
  encodeShuffleProof,
  G,
  generators,
  initialDeck,
  jointKey,
  makeShare,
  provePok,
  proveShuffle,
  type RandomBytes,
  randomScalar,
  type ShuffleCtx,
  shuffleDeck,
  verifyShare,
  verifyShuffle,
} from '../src/index.ts';

const N = 108;
const RUNS = 3;
const DECK_ID = 'tiles';
const rnd: RandomBytes = (n) => new Uint8Array(randomBytes(n));

function time<T>(f: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = f();
  return { ms: performance.now() - t0, value };
}

const fmt = (ms: number): string => `${ms.toFixed(ms < 100 ? 1 : 0)} ms`;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

function main(): void {
  console.info(
    `node ${process.version}, ${process.platform}/${process.arch}; N = ${N}, median of ${RUNS} runs`,
  );

  const setup = time(() => {
    generators(N);
    return cardTable(DECK_ID, N);
  });
  console.info(
    `one-time setup (h, h_1..h_N and the card table, ${2 * N + 1} hash-to-curve): ${fmt(setup.ms)}`,
  );

  const secrets = [randomScalar(rnd), randomScalar(rnd), randomScalar(rnd)];
  const X = jointKey(secrets.map((x) => G.multiply(x)));
  const first = shuffleDeck(initialDeck(DECK_ID, N), X, rnd).out;

  const shuffleMs: number[] = [];
  const proveMs: number[] = [];
  const verifyMs: number[] = [];
  let bytes = { deck: 0, proof: 0 };
  for (let run = 0; run < RUNS; run++) {
    const ctx: ShuffleCtx = { rootId: `bench-${run}`, seat: 1, deckId: DECK_ID };
    const sh = time(() => shuffleDeck(first, X, rnd));
    const { out, psi, rPrime } = sh.value;
    const pr = time(() => proveShuffle(first, out, X, psi, rPrime, ctx, rnd));
    const ve = time(() => verifyShuffle(first, out, X, pr.value, ctx));
    if (!ve.value) throw new Error('bench: an honest proof did not verify');
    shuffleMs.push(sh.ms);
    proveMs.push(pr.ms);
    verifyMs.push(ve.ms);
    bytes = {
      deck: canonicalJson(encodeDeck(out)).length,
      proof: canonicalJson(encodeShuffleProof(pr.value)).length,
    };
  }
  console.info(`shuffleDeck:   ${fmt(median(shuffleMs))}`);
  console.info(`proveShuffle:  ${fmt(median(proveMs))}`);
  console.info(`verifyShuffle: ${fmt(median(verifyMs))}`);
  console.info(
    `shuffle step content: deck ${bytes.deck} + proof ${bytes.proof} = ${bytes.deck + bytes.proof} bytes`,
  );

  const x = secrets[0] as bigint;
  const Xk = G.multiply(x);
  const cts: readonly Ciphertext[] = first;
  const ctxs = cts.map((_, pos) => ({ rootId: 'bench', deckId: DECK_ID, pos }));
  const made = time(() => cts.map((ct, i) => makeShare(x, ct, ctxs[i] as (typeof ctxs)[number], rnd)));
  const checked = time(() =>
    made.value.every((s, i) => verifyShare(Xk, cts[i] as Ciphertext, s, ctxs[i] as (typeof ctxs)[number])),
  );
  if (!checked.value) throw new Error('bench: an honest share did not verify');
  console.info(`makeShare:     ${fmt(made.ms / cts.length)} per share (${cts.length} shares)`);
  console.info(`verifyShare:   ${fmt(checked.ms / cts.length)} per share`);
  const shareBytes = canonicalJson(
    encodeShare({ pos: 0, share: made.value[0] as (typeof made.value)[0] }),
  ).length;
  const pokBytes = canonicalJson(encodePok(provePok(x, ['t', 'n', 's'], rnd))).length;
  console.info(`share content: ${shareBytes} bytes; pok content: ${pokBytes} bytes`);
}

main();
