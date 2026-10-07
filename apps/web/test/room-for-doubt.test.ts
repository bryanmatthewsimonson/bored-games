/*
 * The Room for Doubt game screen (D078), without a browser: the status line (Review Focus 3 and 5), the public record
 * and its privacy (Review Focus 1), the Docket's automatic marks, the card faces and the board's move targets. The
 * states come from the engine's own test helpers, so every case is a position the rules can reach.
 */
import { readFileSync } from 'node:fs';
import { cardOf, type RfdAction, type RfdState, roomForDoubt } from '@bored-games/room-for-doubt';
import { EXHIBIT_GLYPHS } from '@bored-games/room-for-doubt/art';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import {
  act,
  dismiss,
  enter,
  indict,
  only,
  orderWith,
  posOf,
  rollTo,
  showCard,
  started,
  submit,
  VERDICT,
  withPawns,
} from '../../../packages/games/room-for-doubt/test/helpers.ts';
import { ON_ACCENT as ART_ON_ACCENT, PALETTE as ART_PALETTE } from '../../../scripts/room-for-doubt/data.ts';
import { Board } from '../src/games/room-for-doubt/board.tsx';
import { CardFace } from '../src/games/room-for-doubt/cards.tsx';
import {
  ROOM_FOR_DOUBT_SETUP_COPY,
  RoomForDoubtGame,
  StatusLine,
} from '../src/games/room-for-doubt/game.tsx';
import { glyphUri } from '../src/games/room-for-doubt/glyph-image.ts';
import {
  answerTo,
  docketRows,
  forcedAnswer,
  nextMark,
  ON_ACCENT,
  PALETTE,
  parseMarks,
  recordLines,
  statusText,
} from '../src/games/room-for-doubt/model.ts';
import { classOf, findAll, renderTree, spokenText, textOf } from './render-tree.ts';

const NAMES = ['Ann', 'Bob', 'Cleo'];
/** The three-seat deal with the Gavel and Hartley Brine swapped, so Bob (seat 1) holds the Gavel:
 *   seat 0 (Ann, Ashdown): ashdown, crowther, scales, manacles, jury, store
 *   seat 1 (Bob, Reeve):   gavel, faulk, reports, courtroom, robing, cells
 *   seat 2 (Cleo, Faulk):  reeve, brine, carafe, chambers, registry, belfry
 */
const HANDS = [
  'ashdown',
  'gavel',
  'reeve',
  'crowther',
  'faulk',
  'brine',
  'scales',
  'reports',
  'carafe',
  'manacles',
  'courtroom',
  'chambers',
  'jury',
  'robing',
  'registry',
  'store',
  'cells',
  'belfry',
];
const start = (): RfdState => started(3, orderWith(VERDICT, HANDS));
const view = (s: RfdState, seat: number | null): RfdState => roomForDoubt.view(s, seat);

/** Ann, in the Courtroom, submits Lucian Faulk with the Gavel; Bob, holding all three, shows the Gavel. */
function gavelShown(): { asked: RfdState; shown: RfdState } {
  const asked = submit(enter(start(), 'courtroom'), 'faulk', 'gavel');
  return { asked, shown: showCard(asked, posOf(asked, 'gavel')) };
}

describe('statusText (Review Focus 3 and 5)', () => {
  it('names the turn seat at the start, and says "Your turn" to it', () => {
    const s = start();
    expect(statusText(view(s, 2), NAMES, 2)).toBe("Ann's turn: roll the dice or take an action.");
    expect(statusText(view(s, 0), NAMES, 0)).toBe('Your turn: roll the dice or take an action.');
    expect(statusText(view(s, null), NAMES, null)).toBe("Ann's turn: roll the dice or take an action.");
  });

  it('while the dice roll, names the seat whose app adds the next share', () => {
    const s = act(start(), { type: 'roll', actor: 0 });
    expect(s.contributors[0]).toBe(1);
    const line = 'Rolling the dice: waiting for every player’s app to add its share.';
    expect(statusText(view(s, 0), NAMES, 0)).toBe(`${line} Bob’s app is next.`);
    // Bob's own app adds it by itself, so his line names nobody.
    expect(statusText(view(s, 1), NAMES, 1)).toBe(line);
  });

  it('names the seat asked to rebut, and asks that seat for its answer', () => {
    const { asked } = gavelShown();
    expect(statusText(view(asked, 2), NAMES, 2)).toBe("Waiting for Bob to answer Ann's submission.");
    expect(statusText(view(asked, 0), NAMES, 0)).toBe('Waiting for Bob to answer your submission.');
    expect(statusText(view(asked, 1), NAMES, 1)).toBe(
      "Your answer to Ann's submission: show a card or say you have none.",
    );
  });

  it('opens the Verdict for the indicter, then asks for the announcement; the others wait on the indicter', () => {
    const s = indict(start(), 'quarrel', 'clockhand', 'gallery');
    const mine = view(s, 0);
    const unread = { ...mine, verdict: mine.verdict.map((v) => ({ pos: v.pos, card: null })) };
    expect(statusText(unread, NAMES, 0)).toBe('Opening the Verdict: waiting for the other players’ shares.');
    expect(statusText(mine, NAMES, 0)).toBe('The Verdict is open: announce it.');
    expect(statusText(view(s, 1), NAMES, 1)).toBe('Waiting for Ann to open the Verdict and announce it.');
  });

  it('names the winner: an upheld indictment, or the last player standing', () => {
    const s = indict(start(), 'quarrel', 'clockhand', 'gallery');
    const upheld = act(s, { type: 'verdict', actor: 0, upheld: true });
    expect(statusText(view(upheld, 1), NAMES, 1)).toBe('Ann wins: the indictment is upheld.');
    expect(statusText(view(upheld, 0), NAMES, 0)).toBe('You win: the indictment is upheld.');
    const last = dismiss(dismiss(start()));
    expect(last.stage).toBe('over');
    expect(statusText(view(last, 0), NAMES, 0)).toBe('Cleo wins: the last player standing.');
  });

  it('shows a 31-character name whole, inside <bdi>', () => {
    const long = 'Dimitra Alexandropoulou-Smith Q';
    expect(long).toHaveLength(31);
    const names = [long, 'Bob', 'Cleo'];
    const tree = renderTree(h(StatusLine, { state: view(start(), 2), names, me: 2 }));
    const bdi = findAll(tree, (e) => e.tag === 'bdi');
    expect(bdi.map((e) => textOf(e.children))).toEqual([long]);
    expect(spokenText(tree)).toBe(`${long}'s turn: roll the dice or take an action.`);
  });
});

describe('recordLines (Review Focus 1)', () => {
  it('names a shown card to the submitter and to the shower only', () => {
    const { shown } = gavelShown();
    const asked = 'submitted Lucian Faulk with the Gavel in the Courtroom.';
    expect(recordLines(view(shown, 2), NAMES)).toEqual([`Ann ${asked} Bob showed a card.`]);
    expect(recordLines(view(shown, null), NAMES)).toEqual([`Ann ${asked} Bob showed a card.`]);
    expect(recordLines(view(shown, 0), NAMES)).toEqual([`You ${asked} Bob showed you the Gavel.`]);
    expect(recordLines(view(shown, 1), NAMES)).toEqual([`Ann ${asked} You showed Ann the Gavel.`]);
    // The full state knows every card; the record still names none to a seatless reader.
    expect(recordLines(shown, NAMES)).toEqual([`Ann ${asked} Bob showed a card.`]);
  });

  it('shows the submitter, and only the submitter, the card it was shown', () => {
    const { shown } = gavelShown();
    expect(answerTo(view(shown, 0), 0)).toEqual({ by: 1, card: cardOf('gavel') });
    for (const seat of [1, 2, null]) expect(answerTo(view(shown, seat), seat)).toBeNull();
    let s = submit(enter(start(), 'jury'), 'quarrel', 'clockhand');
    s = act(act(s, { type: 'none', actor: 1 }), { type: 'none', actor: 2 });
    expect(answerTo(view(s, 0), 0)).toBe('unrebutted');
  });

  it('reads the same to a third seat whichever card was shown', () => {
    const { asked } = gavelShown();
    const lines = ['gavel', 'faulk', 'courtroom'].map((id) =>
      recordLines(view(showCard(asked, posOf(asked, id as 'gavel')), 2), NAMES),
    );
    expect(lines[1]).toEqual(lines[0]);
    expect(lines[2]).toEqual(lines[0]);
    // A shown Party is named as a card: "the … card".
    const faulk = view(showCard(asked, posOf(asked, 'faulk')), 0);
    expect(recordLines(faulk, NAMES)[0]).toMatch(/Bob showed you the Lucian Faulk card\.$/);
  });

  it('records who had none, an unrebutted submission, and each indictment', () => {
    // Ann names the Verdict's Party and Exhibit in a room she holds: nobody can rebut.
    let s = submit(enter(start(), 'jury'), 'quarrel', 'clockhand');
    s = act(s, { type: 'none', actor: 1 });
    expect(recordLines(view(s, 2), NAMES)).toEqual([
      'Ann submitted Delphine Quarrel with the Clock Hand in the Jury Room. Bob had none.',
    ]);
    s = act(s, { type: 'none', actor: 2 });
    expect(recordLines(view(s, 2), NAMES)).toEqual([
      'Ann submitted Delphine Quarrel with the Clock Hand in the Jury Room. Bob and you had none. Nobody could rebut.',
    ]);
    s = indict(s, 'quarrel', 'clockhand', 'belfry');
    expect(recordLines(view(s, 1), NAMES)[1]).toBe(
      'Ann indicted Delphine Quarrel with the Clock Hand in the Belfry. The Verdict is being opened.',
    );
    s = act(s, { type: 'verdict', actor: 0, upheld: false });
    expect(recordLines(view(s, 0), NAMES)).toEqual([
      'You submitted Delphine Quarrel with the Clock Hand in the Jury Room. Bob and Cleo had none. Nobody could rebut.',
      'You indicted Delphine Quarrel with the Clock Hand in the Belfry. The indictment was dismissed.',
    ]);
  });
});

describe('docketRows', () => {
  it('has 21 rows: 6 Parties, 6 Exhibits, 9 Scenes', () => {
    const rows = docketRows(view(start(), 0), 0);
    expect(rows).toHaveLength(21);
    expect(rows.map((r) => r.kind)).toEqual([
      ...Array(6).fill('party'),
      ...Array(6).fill('exhibit'),
      ...Array(9).fill('scene'),
    ]);
    expect(rows.map((r) => r.card)).toEqual(Array.from({ length: 21 }, (_, i) => i));
    expect(rows[4]?.name).toBe('Lucian Faulk');
    expect(rows[6]?.name).toBe('Gavel');
    expect(rows[20]?.name).toBe('Press Gallery');
  });

  it('marks my hand "held" in my column and a card shown to me "shown" in the shower\'s column', () => {
    const { shown } = gavelShown();
    const rows = docketRows(view(shown, 0), 0);
    const marked = rows.flatMap((r) => r.marks.flatMap((m, seat) => (m === null ? [] : [[r.name, seat, m]])));
    expect(marked).toEqual([
      ['Rosalind Ashdown', 0, 'held'],
      ['Barnaby Crowther', 0, 'held'],
      ['Gavel', 1, 'shown'],
      ['Brass Scales', 0, 'held'],
      ['Manacles', 0, 'held'],
      ['Jury Room', 0, 'held'],
      ['Evidence Store', 0, 'held'],
    ]);
    // Cleo saw nothing shown to her; a spectator has no marks at all.
    expect(docketRows(view(shown, 2), 2).some((r) => r.marks.includes('shown'))).toBe(false);
    expect(docketRows(view(shown, null), null).every((r) => r.marks.every((m) => m === null))).toBe(true);
  });

  it('cycles a tapped cell blank, ✗, ?, blank, and reads saved marks defensively', () => {
    expect([nextMark(null), nextMark('x'), nextMark('?')]).toEqual(['x', '?', null]);
    expect(parseMarks({ '4:1': 'x', '20:0': '?' })).toEqual({ '4:1': 'x', '20:0': '?' });
    expect(parseMarks({ '4:1': 'held', '21:0': 'x', bad: '?', '3:9': 'x' })).toEqual({});
    expect(parseMarks(null)).toEqual({});
    expect(parseMarks(['x'])).toEqual({});
  });
});

describe('cards and the board', () => {
  it('CardFace shows the name, the kind and the glyph as an image', () => {
    const tree = renderTree(h(CardFace, { card: cardOf('gavel') }));
    expect(textOf(tree)).toContain('Gavel');
    expect(textOf(tree)).toContain('Exhibit');
    const imgs = findAll(tree, (e) => e.tag === 'img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.attrs.alt).toBe('');
    expect(String(imgs[0]?.attrs.src)).toMatch(/^data:image\/svg\+xml,/);
    const party = textOf(renderTree(h(CardFace, { card: cardOf('faulk') })));
    expect(party).toContain('Lucian Faulk');
    expect(party).toContain('LF');
    expect(textOf(renderTree(h(CardFace, { card: null })))).toContain('Face down');
  });

  it('glyphUri wraps the art in a 64-unit SVG with its stroke and colour', () => {
    const uri = glyphUri(EXHIBIT_GLYPHS.gavel, '#241f2b');
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"/);
    expect(svg).toContain('color="#241f2b"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain(EXHIBIT_GLYPHS.gavel);
  });

  it('Board offers one target per destination, rooms included, each a labelled button', () => {
    // Ashdown on the Courtroom's west doorstep rolls 2: one step through the door, or two along the corridor.
    const s = rollTo(withPawns(start(), { ashdown: 'H3' }), [1, 1]);
    const moves = only(s, 'move');
    expect(moves.some((m) => m.to === 'courtroom')).toBe(true);
    const tree = renderTree(
      h(Board, { state: s, targets: moves, onMove: () => undefined, expanded: false, names: NAMES }),
    );
    const targets = findAll(tree, (e) => e.attrs['data-action'] !== undefined);
    expect(targets).toHaveLength(moves.length);
    expect(targets.map((e) => JSON.parse(String(e.attrs['data-action'])))).toEqual(moves);
    for (const t of targets) {
      expect(t.attrs.role).toBe('button');
      // The SVG attribute is case-sensitive: a camel-case `tabIndex` would leave the target unfocusable.
      expect(t.attrs.tabindex).toBe(0);
      expect(t.attrs.tabIndex).toBeUndefined();
      expect(String(t.attrs['aria-label'])).toMatch(/^Move to (the Courtroom|[A-X]\d{1,2})$/);
    }
    expect(targets.map((t) => t.attrs['aria-label'])).toContain('Move to the Courtroom');
    expect(targets.map((t) => t.attrs['aria-label'])).toContain('Move to H1');
    // Without targets the board has no buttons at all.
    const still = renderTree(
      h(Board, { state: s, targets: [], onMove: undefined, expanded: false, names: NAMES }),
    );
    expect(findAll(still, (e) => e.attrs.role === 'button')).toEqual([]);
  });

  it('Board draws one square-unit SVG, and the enlarged board carries rfd-board-expanded', () => {
    const s = start();
    const fit = renderTree(
      h(Board, { state: s, targets: [], onMove: undefined, expanded: false, names: NAMES }),
    );
    const big = renderTree(
      h(Board, { state: s, targets: [], onMove: undefined, expanded: true, names: NAMES }),
    );
    const root = (t: ReturnType<typeof renderTree>) => findAll(t, () => true)[0];
    expect(root(fit)?.tag).toBe('svg');
    expect(root(fit)?.attrs.viewBox).toBe('0 0 24 24');
    expect(classOf(root(fit) ?? { tag: '', attrs: {}, children: [] })).not.toContain('rfd-board-expanded');
    expect(classOf(root(big) ?? { tag: '', attrs: {}, children: [] })).toContain('rfd-board-expanded');
    // Six pawns, each with its monogram; six Exhibit tokens once the rooms are revealed.
    expect(findAll(fit, (e) => classOf(e).includes('rfd-pawn'))).toHaveLength(6);
    expect(findAll(fit, (e) => classOf(e).includes('rfd-token'))).toHaveLength(6);
    for (const mono of ['RA', 'HB', 'OR', 'BC', 'LF', 'DQ']) expect(textOf(fit)).toContain(mono);
  });
});

describe('the screen', () => {
  it('sends a forced rebuttal by itself: exactly one answer, none or one card', () => {
    const none: RfdAction = { type: 'none', actor: 2 };
    const show = { type: 'show', actor: 1, pos: 7 } as RfdAction;
    expect(forcedAnswer([none])).toEqual(none);
    expect(forcedAnswer([show])).toEqual(show);
    expect(forcedAnswer([show, { type: 'show', actor: 1, pos: 9 } as RfdAction])).toBeNull();
    expect(forcedAnswer([{ type: 'endTurn', actor: 0 }])).toBeNull();
    expect(forcedAnswer([])).toBeNull();
  });

  it('exports the component and the setup copy for the registry', () => {
    expect(typeof RoomForDoubtGame).toBe('function');
    expect(ROOM_FOR_DOUBT_SETUP_COPY).toEqual({
      shuffling: 'Shuffling the case files',
      dealing: 'Dealing the cards and placing the exhibits…',
      share: { act: 'send a share of the Verdict', owed: 'a share of the Verdict' },
    });
  });

  it("uses the art's palette and accent text colours", () => {
    expect(PALETTE).toEqual(ART_PALETTE);
    expect(ON_ACCENT).toEqual(ART_ON_ACCENT);
  });

  it('defines only rfd- classes in its stylesheet', () => {
    const css = readFileSync(
      new URL('../src/games/room-for-doubt/room-for-doubt.css', import.meta.url),
      'utf8',
    );
    const classes = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(
      (m) => m[1],
    );
    expect(classes.length).toBeGreaterThan(10);
    expect(classes.filter((c) => !c?.startsWith('rfd-'))).toEqual([]);
  });
});
