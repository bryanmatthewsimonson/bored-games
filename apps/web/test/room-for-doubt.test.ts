/*
 * The Room for Doubt game screen (D078), without a browser: the status line (Review Focus 3 and 5), the public record
 * and its privacy (Review Focus 1), the Docket's automatic marks, the card faces and the board's move targets. The
 * states come from the engine's own test helpers, so every case is a position the rules can reach. Then the rules
 * page, the registry entry and the table option, which the game's registration adds.
 */
import { readFileSync } from 'node:fs';
import {
  BOARD_SIZE,
  CORRIDOR,
  cardOf,
  DEFAULT_RULES,
  DOORS,
  ENTRANCES,
  EXHIBITS,
  HAND_POSITIONS,
  PARTIES,
  passageTo,
  type RfdAction,
  type RfdState,
  roomForDoubt,
  SCENES,
  SEAT_PARTIES,
  validateRules,
} from '@bored-games/room-for-doubt';
import { EXHIBIT_GLYPHS } from '@bored-games/room-for-doubt/art';
import { ROOM_FOR_DOUBT_THEME } from '@bored-games/room-for-doubt/theme';
import { h } from 'preact';
import { beforeAll, describe, expect, it } from 'vitest';
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
import { findRestricted, licensedPackStrings } from '../../../tests/restricted-names.ts';
import { SUBMIT_CHOICES } from '../src/components/new-table-form.tsx';
import { webGame } from '../src/games/registry.ts';
import { Board } from '../src/games/room-for-doubt/board.tsx';
import { CardFace } from '../src/games/room-for-doubt/cards.tsx';
import {
  AnswerPanel,
  ROOM_FOR_DOUBT_SETUP_COPY,
  RoomForDoubtGame,
  StatusLine,
} from '../src/games/room-for-doubt/game.tsx';
import { glyphUri } from '../src/games/room-for-doubt/glyph-image.ts';
import {
  answerTo,
  automaticAnswer,
  choicesOf,
  dismissedNotice,
  docketRows,
  nextMark,
  ON_ACCENT,
  PALETTE,
  parseMarks,
  recordLines,
  statusText,
} from '../src/games/room-for-doubt/model.ts';
import {
  ROOM_FOR_DOUBT_RULES_SECTIONS,
  RoomForDoubtRulesContent,
  RoomForDoubtRulesPage,
} from '../src/games/room-for-doubt/rules-page.tsx';
import { MODULES } from '../src/net.ts';
import { parseRoute, rulesHref } from '../src/router.ts';
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
/** Bob's legal actions, from his own view, as the screen gets them. */
const legal1 = (s: RfdState): RfdAction[] => roomForDoubt.legalActions(view(s, 1), 1) as RfdAction[];

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
    // Bob holds all three named cards: he chooses one to show.
    expect(statusText(view(asked, 1), NAMES, 1)).toBe("Your answer to Ann's submission: show a card.");
  });

  it('asks a seat with one named card to show it, and tells a seat with none that its app answers', () => {
    // Ann names her own Party and Exhibit in the Courtroom: Bob holds the Courtroom alone, so he must click it.
    const one = submit(enter(start(), 'courtroom'), 'ashdown', 'scales');
    expect(only(one, 'show', 1)).toHaveLength(1);
    expect(statusText(view(one, 1), NAMES, 1)).toBe("Your answer to Ann's submission: show a card.");
    // In the Jury Room she names three cards of her own: Bob holds none of them, and his app answers for him.
    const none = submit(enter(start(), 'jury'), 'ashdown', 'scales');
    expect(only(none, 'none', 1)).toHaveLength(1);
    expect(statusText(view(none, 1), NAMES, 1)).toBe(
      "Your answer to Ann's submission: you hold none of the three cards, so your app answers for you.",
    );
    expect(statusText(view(none, 2), NAMES, 2)).toBe("Waiting for Bob to answer Ann's submission.");
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

describe('dismissedNotice (a dismissed seat is still needed)', () => {
  const sealing =
    'Your indictment was dismissed, but the game still needs this page open: your app adds your share to every roll of the dice and seals your share of the Verdict for each later indicter, and you still show a card when asked. A closed page holds the game up until the others may claim a timeout and end it.';
  const plainNotice =
    'Your indictment was dismissed, but the game still needs this page open: your app adds your share to every roll of the dice, and you still show a card when asked. A closed page holds the game up until the others may claim a timeout and end it.';

  it('tells the first indicter, once dismissed, that its app also seals the Verdict for later indicters', () => {
    const s = dismiss(start());
    expect(s.players[0]?.dismissed).toBe(true);
    expect(s.stage).toBe('start');
    expect(dismissedNotice(view(s, 0), 0)).toBe(sealing);
    // Nothing for a seat still in the running, or for a spectator.
    expect(dismissedNotice(view(s, 1), 1)).toBeNull();
    expect(dismissedNotice(view(s, null), null)).toBeNull();
  });

  it('tells a later dismissed seat about its dice shares and its rebuttals only', () => {
    // At four seats a second wrong indictment dismisses Bob as well, and the game goes on.
    const s = dismiss(dismiss(started(4)));
    expect(s.players.map((p) => p.dismissed)).toEqual([true, true, false, false]);
    expect(s.stage).toBe('start');
    expect(dismissedNotice(view(s, 1), 1)).toBe(plainNotice);
    expect(dismissedNotice(view(s, 0), 0)).toBe(sealing);
    expect(dismissedNotice(view(s, 2), 2)).toBeNull();
  });

  it('says nothing once the game is over', () => {
    // At three seats two dismissals leave Cleo standing alone, and she wins.
    const over = dismiss(dismiss(start()));
    expect(over.stage).toBe('over');
    for (const seat of [0, 1, 2]) expect(dismissedNotice(view(over, seat), seat)).toBeNull();
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
  it('answers by itself only with a lone none: every show waits for its player (ruling 7, amended)', () => {
    const none: RfdAction = { type: 'none', actor: 2 };
    const show = { type: 'show', actor: 1, pos: 7 } as RfdAction;
    expect(automaticAnswer([none])).toEqual(none);
    // A show, even of the only card the seat can show, waits for a click: sent at once, it would tell every seat
    // that the shower holds exactly one of the three cards.
    expect(automaticAnswer([show])).toBeNull();
    expect(automaticAnswer([show, { type: 'show', actor: 1, pos: 9 } as RfdAction])).toBeNull();
    expect(automaticAnswer([{ type: 'endTurn', actor: 0 }])).toBeNull();
    expect(automaticAnswer([])).toBeNull();
  });

  it('the answer panel: a lone none says the app answers; a show, even of one card, waits for a click', () => {
    const panel = (s: RfdState, legalList: readonly RfdAction[], enabled = true) => {
      const choices = choicesOf(legalList);
      return renderTree(
        h(AnswerPanel, {
          state: view(s, 1),
          me: 1,
          names: NAMES,
          shows: choices.shows,
          none: choices.none,
          enabled,
          onSend: () => {},
        }),
      );
    };
    const buttons = (tree: ReturnType<typeof renderTree>) =>
      findAll(tree, (e) => e.tag === 'button').map((b) => ({
        label: (b.attrs['aria-label'] as string | undefined) ?? spokenText([b]),
        action: JSON.parse(String(b.attrs['data-action'])) as RfdAction,
        disabled: b.attrs.disabled,
      }));
    // Bob holds none of the three: the app answers for him, and the button stays for a send by hand.
    const none = submit(enter(start(), 'jury'), 'ashdown', 'scales');
    const noneTree = panel(none, legal1(none));
    expect(spokenText(noneTree)).toContain('You hold none of the three cards, so your app answers for you.');
    expect(spokenText(noneTree)).not.toMatch(/being sent|is sent/);
    expect(buttons(noneTree)).toEqual([
      { label: 'Say you have none', action: { type: 'none', actor: 1 }, disabled: false },
    ]);
    // Bob holds the Courtroom alone: one show button, which he clicks.
    const one = submit(enter(start(), 'courtroom'), 'ashdown', 'scales');
    const oneTree = panel(one, legal1(one));
    expect(spokenText(oneTree)).toContain('Show this card. Only Ann will see it.');
    expect(buttons(oneTree)).toEqual([
      {
        label: 'Show the Courtroom',
        action: { type: 'show', actor: 1, pos: posOf(one, 'courtroom') },
        disabled: false,
      },
    ]);
    // Bob holds all three named cards: a button for each, his choice.
    const { asked } = gavelShown();
    const allTree = panel(asked, legal1(asked));
    expect(spokenText(allTree)).toContain('Show one of your cards. Only Ann will see which.');
    expect(new Set(buttons(allTree).map((b) => b.label))).toEqual(
      new Set(['Show the Gavel', 'Show the Lucian Faulk card', 'Show the Courtroom']),
    );
    expect(buttons(allTree)).toHaveLength(3);
    // While the seat may not act (a send in flight), every answer is disabled.
    expect(buttons(panel(one, legal1(one), false)).map((b) => b.disabled)).toEqual([true]);
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

describe('the rules page', () => {
  const root = new URL('../../..', import.meta.url).pathname;
  let strings: string[] = [];
  beforeAll(async () => {
    strings = await licensedPackStrings(root);
  });

  const tree = renderTree(h(RoomForDoubtRulesContent, null));
  const text = spokenText(tree);
  const section = (id: string) =>
    findAll(tree, (e) => e.tag === 'section' && e.attrs['aria-labelledby'] === `rules-${id}`);
  const theme = ROOM_FOR_DOUBT_THEME;
  /** The cells of every table row, as text. */
  const rows = findAll(tree, (e) => e.tag === 'tr').map((tr) =>
    findAll(tr.children, (c) => c.tag === 'th' || c.tag === 'td').map((c) => textOf(c.children).trim()),
  );

  it('renders the rules from the engine’s numbers', () => {
    for (const phrase of ['21 cards', '3 to 6 players', '6, 6, 6', 'Old Gaol Passage'])
      expect(text, phrase).toContain(phrase);
    // The phrases above are the engine's numbers: 6 + 6 + 9 cards, its seat range and its names.
    expect(PARTIES.length + EXHIBITS.length + SCENES.length).toBe(21);
    expect(roomForDoubt.seatRange(DEFAULT_RULES)).toEqual({ min: 3, max: 6 });
    expect(theme.passage).toBe('Old Gaol Passage');
    // One h2 for the contents and one for each section id, in order.
    expect(ROOM_FOR_DOUBT_RULES_SECTIONS.map((s) => s.id)).toEqual([
      'goal',
      'setup',
      'turn',
      'rebut',
      'indict',
      'end',
      'board',
      'online',
    ]);
    const h2 = findAll(tree, (e) => e.tag === 'h2');
    expect(h2.map((e) => spokenText([e]))).toEqual([
      'Contents',
      ...ROOM_FOR_DOUBT_RULES_SECTIONS.map((s) => s.title),
    ]);
    expect(h2.slice(1).map((e) => e.attrs.id)).toEqual(
      ROOM_FOR_DOUBT_RULES_SECTIONS.map((s) => `rules-${s.id}`),
    );
    expect(ROOM_FOR_DOUBT_RULES_SECTIONS.find((s) => s.id === 'online')?.title).toBe('Playing on this site');
  });

  it('links every section from its contents list', () => {
    const links = findAll(
      findAll(tree, (e) => e.tag === 'nav'),
      (e) => e.tag === 'a',
    );
    expect(links.map((a) => a.attrs.href)).toEqual(
      ROOM_FOR_DOUBT_RULES_SECTIONS.map((s) => rulesHref('room-for-doubt', s.id)),
    );
    for (const s of ROOM_FOR_DOUBT_RULES_SECTIONS) expect(section(s.id), s.id).toHaveLength(1);
  });

  it('deals each table size as the engine does: the Parties played and the cards of each hand', () => {
    for (const seats of [3, 4, 5, 6] as const) {
      const row = rows.find((r) => r[0] === String(seats));
      expect(row, `${seats} players`).toBeDefined();
      // Hand position k goes to seat k mod n, from the first seat (P2).
      const sizes = Array.from(
        { length: seats },
        (_, seat) => HAND_POSITIONS.filter((_p, k) => k % seats === seat).length,
      );
      expect(row?.[2]).toBe(sizes.join(', '));
      const played = new Set(SEAT_PARTIES[seats]);
      for (const [party, p] of theme.parties.entries())
        expect(row?.[1]?.includes(p.name), `${seats} players, ${p.name}`).toBe(played.has(party));
    }
    expect(rows.find((r) => r[0] === '4')?.[2]).toBe('5, 5, 4, 4');
    expect(rows.find((r) => r[0] === '5')?.[2]).toBe('4, 4, 4, 3, 3');
    expect(text).toContain(`${HAND_POSITIONS.length} other cards`);
  });

  it('describes the board from the engine: its totals, rooms, Entrances and passages', () => {
    const board = spokenText(section('board'));
    expect(board).toContain(`${BOARD_SIZE} × ${BOARD_SIZE}`);
    expect(board).toContain(`${DOORS.length} doors`);
    expect(board).toContain(`${CORRIDOR.size} corridor squares`);
    expect(ENTRANCES).toHaveLength(6);
    for (const scene of theme.scenes) expect(board, scene).toContain(scene);
    for (const p of theme.parties) {
      expect(board, p.door).toContain(p.door);
      expect(board, p.name).toContain(p.name);
    }
    const passages = SCENES.flatMap((room, i) => {
      const to = passageTo(room);
      return to !== null && i < SCENES.indexOf(to) ? [[room, to] as const] : [];
    });
    expect(passages).toHaveLength(2);
    for (const [a, b] of passages)
      expect(board).toContain(
        `the ${theme.scenes[SCENES.indexOf(a)]} with the ${theme.scenes[SCENES.indexOf(b)]}`,
      );
  });

  it('shows one card of each kind and the board at the start, as pictures with no controls', () => {
    const cards = findAll(tree, (e) => classOf(e).includes('rfd-card'));
    expect(cards.map((c) => c.attrs['data-kind'])).toEqual(['party', 'exhibit', 'scene']);
    const boards = findAll(tree, (e) => e.tag === 'svg');
    expect(boards).toHaveLength(1);
    expect(boards[0]?.attrs.viewBox).toBe('0 0 24 24');
    expect(findAll(tree, (e) => classOf(e).includes('rfd-pawn'))).toHaveLength(6);
    expect(findAll(tree, (e) => e.attrs.role === 'button' || e.attrs['data-action'] !== undefined)).toEqual(
      [],
    );
  });

  it('explains playing on this site: the automatic steps, the private show, a dismissed seat, the Docket, the board and Resign', () => {
    const online = section('online');
    const labels = findAll(online, (e) => e.tag === 'strong').map((e) => spokenText([e]));
    expect(labels).toEqual([
      'Dice shares.',
      'Verdict shares.',
      'Sealed shares.',
      'Rebuttals.',
      'A shown card.',
      'Dismissed.',
      'The Docket.',
      'Enlarge board.',
      'Resign.',
      'Deadlines.',
      'The check.',
    ]);
    const words = spokenText(online);
    expect(words).toContain('Only the submitter sees which card');
    // A none goes out by itself; a show, even of the only card, waits for its player (ruling 7, amended).
    expect(words).toContain('your app says so for you, without a click');
    expect(words).toContain('even when only one is possible');
    // A dismissed player's app is still needed.
    expect(words).toContain('After a wrong indictment you take no more turns, but keep the game open');
    expect(words).toContain('Resign is not offered');
    expect(words).toContain('Enlarge board');
    expect(words).toContain('Docket');
  });

  it('names no reference game, designer or publisher', () => {
    expect(strings.length).toBeGreaterThan(0);
    expect(findRestricted(JSON.stringify(tree), strings)).toEqual([]);
  });
});

describe('the registration', () => {
  it('hosts the game: its module, its names, its screen, its rules page and its setup copy', () => {
    expect(MODULES.get('room-for-doubt')).toBe(roomForDoubt);
    const game = webGame('room-for-doubt');
    expect(game?.title()).toBe(ROOM_FOR_DOUBT_THEME.title);
    expect(game?.tagline()).toBe(ROOM_FOR_DOUBT_THEME.tagline);
    expect(game?.Component).toBe(RoomForDoubtGame);
    expect(game?.RulesPage).toBe(RoomForDoubtRulesPage);
    expect(game?.setupCopy(true)).toEqual(ROOM_FOR_DOUBT_SETUP_COPY);
  });

  it('asks the controller to send a lone none by itself, and never a show (ruling 7, amended)', () => {
    const auto = webGame('room-for-doubt')?.autoMove;
    const none: RfdAction = { type: 'none', actor: 1 };
    const show = { type: 'show', actor: 1, pos: 7 } as RfdAction;
    expect(auto?.([none], start(), 1)).toEqual(none);
    expect(auto?.([show], start(), 1)).toBeNull();
    expect(auto?.([show, { type: 'show', actor: 1, pos: 9 } as RfdAction], start(), 1)).toBeNull();
    expect(auto?.([{ type: 'roll', actor: 1 }], start(), 1)).toBeNull();
  });

  it('routes its game page and its rules page, whole and by section', () => {
    expect(parseRoute('#/games/room-for-doubt')).toEqual({ name: 'game-page', game: 'room-for-doubt' });
    expect(parseRoute(rulesHref('room-for-doubt'))).toEqual({
      name: 'rules',
      game: 'room-for-doubt',
      section: null,
    });
    expect(parseRoute(rulesHref('room-for-doubt', 'online'))).toEqual({
      name: 'rules',
      game: 'room-for-doubt',
      section: 'online',
    });
  });

  it('offers the submit option and validates it', () => {
    expect(validateRules({ submit: 'required' }).ok).toBe(true);
    expect(validateRules({ submit: 'optional' }).ok).toBe(true);
    expect(validateRules({ submit: 'sometimes' }).ok).toBe(false);
    expect(validateRules({}).ok).toBe(false);
    // The New table form offers exactly these two choices, named as the legend "Submissions on entering a room"
    // sets them, and each is a rule the engine accepts; the first is the engine's default.
    expect(SUBMIT_CHOICES.map((c) => c.label)).toEqual(['Optional', 'Required']);
    for (const c of SUBMIT_CHOICES) expect(validateRules({ submit: c.value }).ok, c.label).toBe(true);
    expect(SUBMIT_CHOICES[0]?.value).toBe(DEFAULT_RULES.submit);
    // The table's rules are what the module accepts, and a table made without the option plays the default.
    expect(DEFAULT_RULES).toEqual({ submit: 'optional' });
    expect(roomForDoubt.validateRules({ submit: 'required' })).toEqual({
      ok: true,
      value: { submit: 'required' },
    });
  });
});
