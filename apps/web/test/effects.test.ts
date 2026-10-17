/*
 * Sounds, highlights and the "Since your last move" recap (D095): the cue patches and the board that plays them, the
 * Sound setting, the pure recap helpers, Chess's and Chain Reaction's recaps, and the recap strip.
 */
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { describe, expect, it } from 'vitest';
import { RecapStrip } from '../src/components/recap-strip.tsx';
import { crRecap } from '../src/games/chain-reaction/model.ts';
import { chessRecap, slideOffset } from '../src/games/chess/model.ts';
import { GAMES, webGame } from '../src/games/registry.ts';
import type { RecapStep } from '../src/games/types.ts';
import { appended, cueOf, recentOf, replayRecent, sinceOwn, turnTitle } from '../src/recap.ts';
import { createSettings } from '../src/settings.ts';
import { type AudioLike, type Cue, cueAllowed, PATCHES, SoundBoard } from '../src/sound.ts';
import { memoryStorage } from '../src/storage.ts';
import { classOf, findAll, renderTree, textOf } from './render-tree.ts';

/** A fake AudioContext that counts the oscillators started. */
function fakeAudio(state = 'running') {
  const started: { type: string; at: number }[] = [];
  const param = () => ({
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  });
  const ctx = {
    currentTime: 5,
    state,
    destination: {},
    resumed: 0,
    async resume() {
      this.resumed++;
      this.state = 'running';
    },
    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: param(),
        connect: () => undefined,
        start: (at: number) => started.push({ type: osc.type, at }),
        stop: () => undefined,
      };
      return osc;
    },
    createGain: () => ({ gain: param(), connect: () => undefined }),
  };
  return { ctx: ctx as AudioLike & { resumed: number }, started };
}

const step = (seat: number | null, marks: string[], cue: Cue | null = 'place'): RecapStep => ({
  seat,
  text: `seat ${seat} played ${marks.join('-')}`,
  marks,
  cue,
});

describe('sound cues', () => {
  it('keeps every cue short and quiet', () => {
    for (const [cue, notes] of Object.entries(PATCHES)) {
      expect(notes.length, cue).toBeGreaterThan(0);
      for (const n of notes) {
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(0.3);
        expect(n.at + n.dur).toBeLessThan(1);
      }
    }
  });

  it('plays every cue in all, only the alerts in turn, nothing when off', () => {
    expect(cueAllowed('all', 'place')).toBe(true);
    expect(cueAllowed('turn', 'place')).toBe(false);
    expect(cueAllowed('turn', 'yourTurn')).toBe(true);
    expect(cueAllowed('turn', 'gameOver')).toBe(true);
    expect(cueAllowed('off', 'yourTurn')).toBe(false);
  });

  it('stays silent and makes no context until unlocked', () => {
    let made = 0;
    const { ctx, started } = fakeAudio();
    const board = new SoundBoard(() => {
      made++;
      return ctx;
    });
    expect(board.play('place', 'all')).toBe(false);
    expect(made).toBe(0);
    board.unlock();
    expect(made).toBe(1);
    expect(board.play('yourTurn', 'all')).toBe(true);
    expect(started).toHaveLength(PATCHES.yourTurn.length);
    expect(board.play('place', 'turn')).toBe(false);
    expect(board.play('place', 'all', 0)).toBe(false);
    board.unlock();
    expect(made).toBe(1);
  });

  it('resumes a suspended context, and gives up where there is no Web Audio', async () => {
    const { ctx } = fakeAudio('suspended');
    const board = new SoundBoard(() => ctx);
    board.unlock();
    await Promise.resolve();
    expect(ctx.resumed).toBe(1);
    expect(board.ready).toBe(true);
    let tries = 0;
    const none = new SoundBoard(() => {
      tries++;
      return null;
    });
    none.unlock();
    none.unlock();
    expect(tries).toBe(1);
    expect(none.play('place', 'all')).toBe(false);
  });
});

describe('the Sound setting', () => {
  it('is stored per profile under bg:<profile>:sound, all by default', () => {
    const store = memoryStorage();
    const s = createSettings('alice', store, false);
    expect(s.sound.value).toBe('all');
    expect(s.setSound('turn')).toBe(true);
    expect(store.getItem('bg:alice:sound')).toBe('turn');
    expect(createSettings('alice', store, false).sound.value).toBe('turn');
    expect(createSettings('bob', store, false).sound.value).toBe('all');
    expect(s.setSound('all')).toBe(true);
    expect(store.getItem('bg:alice:sound')).toBeNull();
  });

  it('ignores a stored value it does not know', () => {
    const store = memoryStorage();
    store.setItem('bg:alice:sound', 'loud');
    expect(createSettings('alice', store, false).sound.value).toBe('all');
  });
});

describe('the recap helpers', () => {
  it('finds the events appended since the last view by identity', () => {
    const a = { type: 'x' };
    const b = { type: 'x' };
    const c = { type: 'y' };
    expect(appended(null, [a])).toBeNull();
    expect(appended([a], [a])).toEqual([]);
    const prev = [a];
    expect(appended(prev, prev)).toEqual([]);
    expect(appended([], [a, b])).toEqual([a, b]);
    expect(appended([a, b], [a, b, c])).toEqual([c]);
    // The oldest events dropped off the front: still found.
    expect(appended([a, b], [b, c])).toEqual([c]);
    // An equal but distinct event is not the same one: a branch switch.
    expect(appended([a, { type: 'x' }], [a, b, c])).toBeNull();
  });

  it('highlights the plays since the viewer’s own last one', () => {
    const steps = [
      step(0, ['a']),
      step(1, ['b']),
      step(2, ['c']),
      step(0, ['d']),
      step(1, ['e']),
      step(2, ['f']),
    ];
    expect(sinceOwn(steps, 0).map((s) => s.marks[0])).toEqual(['e', 'f']);
    expect(sinceOwn(steps, 2).map((s) => s.marks[0])).toEqual(['f']);
    expect(sinceOwn(steps, null).map((s) => s.marks[0])).toEqual(['f']);
    expect(sinceOwn(steps, 5)).toHaveLength(6);
    expect(sinceOwn([], 0)).toEqual([]);
  });

  it('marks every recent play and the newest one, and whose it is', () => {
    const steps = [step(1, ['b', 'c']), step(2, ['d'])];
    const r = recentOf(steps, 0, 3);
    expect([...r.marks]).toEqual(['b', 'c', 'd']);
    expect([...r.latest]).toEqual(['d']);
    expect(r.mine).toBe(false);
    expect(r.pulse).toBe(3);
    expect(recentOf([step(0, ['x'])], 0, 0).mine).toBe(true);
    expect(recentOf([step(0, ['x'])], null, 0).mine).toBe(false);
    const replay = replayRecent(steps, 0, 0, 7);
    expect([...replay.marks]).toEqual(['b', 'c']);
    expect([...replay.latest]).toEqual(['b', 'c']);
    expect([...replayRecent(steps, 9, 0, 0).marks]).toEqual([]);
  });

  it('plays one cue per arrival, the loudest', () => {
    expect(cueOf([step(0, [], 'place'), step(1, [], 'merge'), step(2, [], 'found')])).toBe('merge');
    expect(cueOf([step(0, [], null)])).toBeNull();
    expect(cueOf([])).toBeNull();
  });

  it('words the background title', () => {
    expect(turnTitle('Chess')).toBe('(Your turn) Chess');
  });
});

describe('game recaps', () => {
  const moved = (seat: 0 | 1, uci: string, san: string, extra: Record<string, unknown> = {}) => ({
    type: 'moved',
    seat,
    uci,
    san,
    piece: 'P',
    captured: null,
    castle: null,
    enPassant: false,
    promotion: null,
    check: false,
    ...extra,
  });

  it('Chess: one step per move on its from and to squares, with its sound', () => {
    const steps = chessRecap(
      [
        moved(0, 'e2e4', 'e4'),
        moved(1, 'd7d5', 'd5'),
        moved(0, 'e4d5', 'exd5', { captured: 'p' }),
        { type: 'drawOffered', seat: 1 },
        moved(1, 'd8d5', 'Qxd5+', { captured: 'P', check: true }),
        { type: 'somethingElse' },
        null,
      ],
      ['Ann', 'Bo'],
    );
    expect(steps.map((s) => s.cue)).toEqual(['place', 'place', 'capture', null, 'check']);
    expect(steps[0]).toMatchObject({ seat: 0, marks: ['e2', 'e4'] });
    expect(steps[0]?.text).toMatch(/^Ann \(.+\) played e4\.$/);
    expect(steps[3]).toMatchObject({ seat: 1, marks: [] });
    expect(steps[3]?.text).toMatch(/offered a draw/);
  });

  it('Chess: slides a piece toward where it landed, on either side of the board', () => {
    expect(slideOffset('e2', 'e4', false)).toEqual({ dx: 0, dy: 2 });
    expect(slideOffset('g1', 'f3', false)).toEqual({ dx: 1, dy: 2 });
    expect(slideOffset('g1', 'f3', true)).toEqual({ dx: -1, dy: -2 });
  });

  it('Chain Reaction: one step per tile placed, never a count or an amount', () => {
    const steps = crRecap(
      CHAIN_REACTION_THEME,
      [
        { type: 'turnStarted', seat: 0, turn: 1 },
        { type: 'tilePlaced', seat: 0, tile: '7C', kind: 'lone' },
        { type: 'sharesBought', seat: 0, buys: [] },
        { type: 'tilePlaced', seat: 1, tile: '8C', kind: 'found' },
        { type: 'placementSkipped', seat: 2 },
        { type: 'tilePlaced', seat: 0, tile: '9C', kind: 'merge' },
      ],
      ['Ann', 'Bo', 'Cy'],
    );
    expect(steps.map((s) => [s.seat, s.marks, s.cue])).toEqual([
      [0, ['7C'], 'place'],
      [1, ['8C'], 'found'],
      [2, [], null],
      [0, ['9C'], 'merge'],
    ]);
    expect(steps[0]?.text).toBe('Ann placed 7C.');
    expect(steps[3]?.text).toBe('Ann placed 9C, causing a merger.');
    for (const s of steps) expect(s.text).not.toMatch(/\$|\d+ shares?/);
  });

  it('the registry gives Chess and Chain Reaction a recap', () => {
    expect(webGame('chess')?.recap).toBeTypeOf('function');
    expect(webGame('chain-reaction')?.recap).toBeTypeOf('function');
    expect(GAMES.filter((g) => g.recap !== undefined).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the recap strip', () => {
  const steps = [step(1, ['b']), step(2, ['c'])];

  it('lists the plays since the viewer’s last move, with a Replay button', () => {
    let replays = 0;
    const tree = renderTree(
      RecapStrip({ steps, mySeat: 0, replaying: null, onReplay: () => replays++, onStop: () => undefined }),
    );
    expect(textOf(tree)).toMatch(/Since your last move/);
    expect(findAll(tree, (el) => el.tag === 'li')).toHaveLength(2);
    const buttons = findAll(tree, (el) => el.tag === 'button');
    expect(textOf(buttons)).toBe('Replay all 2');
    for (const b of buttons) (b.attrs.onClick as () => void)();
    expect(replays).toBe(1);
  });

  it('marks the step on show during a replay, and offers to stop', () => {
    const tree = renderTree(
      RecapStrip({ steps, mySeat: 0, replaying: 1, onReplay: () => undefined, onStop: () => undefined }),
    );
    const items = findAll(tree, (el) => el.tag === 'li');
    expect(items.map((el) => classOf(el).includes('current'))).toEqual([false, true]);
    expect(textOf(findAll(tree, (el) => el.tag === 'button'))).toBe('Stop the replay');
  });

  it('is not shown to a spectator, or when only the viewer has played', () => {
    const none = { replaying: null, onReplay: () => undefined, onStop: () => undefined };
    expect(renderTree(RecapStrip({ steps, mySeat: null, ...none }))).toEqual([]);
    expect(renderTree(RecapStrip({ steps: [step(0, ['a'])], mySeat: 0, ...none }))).toEqual([]);
  });
});
