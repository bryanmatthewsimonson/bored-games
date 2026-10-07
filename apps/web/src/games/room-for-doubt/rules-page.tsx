/*
 * The player-facing Room for Doubt rules (#/rules/room-for-doubt), after docs/games/room-for-doubt/RULES.md. The
 * numbers come from the engine, the names from the theme, and "Playing on this site" says what this build adds to
 * the table rules (D078). `RoomForDoubtRulesContent` uses no hooks, so tests can expand it without a DOM.
 */
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
  type RfdState,
  roomForDoubt,
  SCENES,
  SEAT_PARTIES,
} from '@bored-games/room-for-doubt';
import { ROOM_FOR_DOUBT_THEME as THEME } from '@bored-games/room-for-doubt/theme';
import { type ComponentChildren, Fragment } from 'preact';
import { useEffect } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import { Board } from './board.tsx';
import { CardFace } from './cards.tsx';
import { ROOM_FOR_DOUBT_META } from './meta.ts';
import { partyName, sceneName } from './model.ts';
import '../chain-reaction/rules.css';
import './room-for-doubt.css';

export const ROOM_FOR_DOUBT_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'setup', title: 'Setup' },
  { id: 'turn', title: 'Your turn' },
  { id: 'rebut', title: 'Rebutting a submission' },
  { id: 'indict', title: 'Indict' },
  { id: 'end', title: 'The end' },
  { id: 'board', title: 'The board' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = ROOM_FOR_DOUBT_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

/** "a", "a and b", "a, b and c". */
function andList(items: readonly string[]): string {
  const last = items.at(-1);
  if (last === undefined) return '';
  return items.length === 1 ? last : `${items.slice(0, -1).join(', ')} and ${last}`;
}

/** The seat counts the game allows, the Parties each plays and the cards each seat is dealt (P1, P2). */
const TABLES = Object.entries(SEAT_PARTIES).map(([n, parties]) => {
  const seats = Number(n);
  return {
    seats,
    parties: parties.map(partyName),
    // Hand position k goes to seat k mod n, from the first seat.
    hands: Array.from(
      { length: seats },
      (_, seat) => HAND_POSITIONS.filter((_pos, k) => k % seats === seat).length,
    ),
  };
});

/** The corner rooms, which the Old Gaol Passages join in diagonal pairs (each pair once). */
const CORNERS = SCENES.filter((room) => passageTo(room) !== null);
const PASSAGES = SCENES.flatMap((room) => {
  const to = passageTo(room);
  return to !== null && SCENES.indexOf(room) < SCENES.indexOf(to) ? [[room, to] as const] : [];
});

/** A game of `seats` at its start, only for the picture of the board: every pawn on its Entrance. */
function openingState(seats: number): RfdState | null {
  const start = roomForDoubt.setup({ rules: DEFAULT_RULES, seats, mode: 'view', viewer: null });
  return start.ok ? start.value : null;
}

export function RoomForDoubtRulesContent() {
  const seats = roomForDoubt.seatRange(DEFAULT_RULES);
  const cards = PARTIES.length + EXHIBITS.length + SCENES.length;
  const first = THEME.parties[0];
  // At the largest table every Party is played, so every pawn has a seat.
  const opening = openingState(seats.max);
  return (
    <article class="rules-page rfd-rules">
      <header class="rules-head">
        <h1>How to play {THEME.title}</h1>
        <p class="lede">{THEME.tagline}</p>
      </header>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {ROOM_FOR_DOUBT_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(ROOM_FOR_DOUBT_META.id, s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          Six people are trapped in the Aldermoor Assize Courts on the night before a verdict, and the judge
          is dead. In this game for {seats.min} to {seats.max} players you walk the building, make submissions
          in its rooms, rebut the others with the cards you hold, and race to indict the right Party, the
          right Exhibit and the right Scene.
        </p>
        <p>
          The true account is sealed in {THEME.verdict}: one Party, one Exhibit and one Scene that nobody has
          seen. The first player to name all three correctly wins. You may indict only once, and a wrong
          indictment puts you out of the running.
        </p>
      </Section>

      <Section id="setup">
        <p>
          There are {cards} cards: {PARTIES.length} Parties, {EXHIBITS.length} Exhibits and {SCENES.length}{' '}
          Scenes. Every card shows its kind and a picture, and a Party card its monogram too, so colour is
          never the only cue.
        </p>
        <ul class="rfd-cards rfd-samples" aria-hidden="true">
          {(['ashdown', 'gavel', 'courtroom'] as const).map((id) => (
            <li key={id}>
              <CardFace card={cardOf(id)} />
            </li>
          ))}
        </ul>
        <p>
          One Party card, one Exhibit card and one Scene card are chosen blind and sealed as {THEME.verdict}.
          They are dealt to nobody. The {HAND_POSITIONS.length} other cards are dealt face down, one at a
          time, starting with the first player, so every card is held by exactly one player. Some hands are
          larger than others, and that is intended.
        </p>
        <table class="rfd-rules-table">
          <caption>The Parties played and the cards dealt to each seat, by number of players</caption>
          <thead>
            <tr>
              <th scope="col">Players</th>
              <th scope="col">Parties played</th>
              <th scope="col">Cards per seat</th>
            </tr>
          </thead>
          <tbody>
            {TABLES.map((t) => (
              <tr key={t.seats}>
                <th scope="row">{t.seats}</th>
                <td>{andList(t.parties)}</td>
                <td>{t.hands.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          The Parties are spread evenly round the building, in turn order, so {first.name}, the {first.role},
          is always played and goes first. Every pawn, played or not, stands on its Entrance. A pawn of a
          Party nobody plays stays there until a submission names it. It can be named, and it blocks its
          square like any pawn.
        </p>
        <p>
          The {EXHIBITS.length} Exhibit tokens go to {EXHIBITS.length} different rooms, one in each, picked at
          random from the {SCENES.length} by the shuffle: no player can choose them. Play then passes in seat
          order.
        </p>
      </Section>

      <Section id="turn">
        <p>
          A turn has a movement, then, if you are entitled to one, a submission, then the end. You may indict
          at any point of your own turn, and an indictment ends it (see Indict). Play passes over a dismissed
          player, who takes no turns.
        </p>
        <h3>1. Move</h3>
        <p>Do one of these three things.</p>
        <ul>
          <li>
            <strong>Roll and walk.</strong> Roll the two dice and walk your pawn exactly the total, from 2 to
            12 squares, one square at a time: up, down, left or right, never diagonally. You may turn as often
            as you like.
            <ul>
              <li>
                You may not enter or end on a square that holds a pawn: another player's, an unplayed Party's
                or a dismissed Party's. Rooms are not squares in this sense: any number of pawns and tokens
                may stand in a room.
              </li>
              <li>You may not enter the same square twice in one turn.</li>
              <li>
                A door is passed in one step, between its doorstep (the corridor square outside it) and the
                room. The doorway itself is not a square. A door whose doorstep holds another pawn cannot be
                used, in either direction.
              </li>
              <li>
                Entering a room ends your move, however much of the roll is left. You may not enter a room
                that you left earlier in the same turn.
              </li>
              <li>
                You must use the whole roll, or enter a room on the way. If neither is possible, you move
                along the longest legal path there is, which may be no squares at all. The board shows you
                exactly where you may stop.
              </li>
            </ul>
          </li>
          <li>
            <strong>Take the {THEME.passage}.</strong> If your pawn starts the turn in a corner room, you may
            skip the roll and move at once to the corner room diagonally opposite. You count as having entered
            it.
          </li>
          <li>
            <strong>Stay.</strong> If your pawn cannot move at all, because every route is blocked or it is
            walled in, you pass your move: the game offers Stay instead of the roll. You may still indict.
          </li>
        </ul>
        <h3>2. Submit</h3>
        <p>
          A submission is a question to the table. You may make one when you have just entered a room, by
          walking or by a passage. A Party that another player's submission moved into a room may make one at
          the start of its next turn instead of rolling, or leave normally.
        </p>
        <ul>
          <li>
            You name one Party and one Exhibit, and the room you are standing in. You may name any Party and
            any Exhibit, including cards you hold yourself and items already in the room.
          </li>
          <li>
            The named Party's pawn and the named Exhibit's token are placed in your room. Nothing moves if one
            is already there. A Party named in a submission moves whether it is played, unplayed or dismissed.
          </li>
          <li>
            You may not submit twice in a room unless you leave and enter it again, or another player's
            submission moves you there again. A Party that was already in the room is not moved, and gains
            nothing.
          </li>
          <li>
            <strong>Submissions on entering a room</strong> is an option of the table. At an Optional table
            (the default) a submission is your choice. At a Required table you must submit in the room you
            entered before you can end your turn, or indict instead.
          </li>
        </ul>
      </Section>

      <Section id="rebut">
        <p>
          The other players are asked in turn order, starting with the player after the submitter. A dismissed
          player is asked like any other.
        </p>
        <ul>
          <li>
            A player holding at least one of the three named cards (the Party, the Exhibit and the room's
            Scene) must show exactly one of them to the submitter alone, and the asking stops there. A player
            holding several chooses which to show.
          </li>
          <li>A player holding none says so, and the next player is asked.</li>
          <li>Everyone sees that a card was shown, and by whom. Only the submitter sees which card.</li>
          <li>
            If every other player says they hold none, the submission stands unrebutted. You may end your turn
            or indict.
          </li>
        </ul>
      </Section>

      <Section id="indict">
        <ul>
          <li>
            A player who is not dismissed may indict, once per game, at any point of their own turn: before
            moving, after rolling, after moving, or after a submission, whether or not it was rebutted.
          </li>
          <li>
            You name any Party, any Exhibit and any Scene. The Scene need not be the room you stand in. Then
            you, and nobody else, look at {THEME.verdict} in secret.
          </li>
          <li>
            <strong>Upheld.</strong> If your three cards match {THEME.verdict} exactly, the game ends and you
            win.
          </li>
          <li>
            <strong>Dismissed.</strong> Otherwise you are dismissed. You may no longer move, submit or indict,
            and {THEME.verdict} goes back sealed, unseen by anyone else. You keep your hand, and you still
            rebut. Your pawn stays where it is, and other players' submissions may still name your Party and
            move your pawn. If your pawn stands on a doorstep, it moves into that door's room at once, so that
            it never blocks the door.
          </li>
        </ul>
      </Section>

      <Section id="end">
        <p>
          The game ends the moment an indictment is upheld: that player wins. It also ends when every player
          but one has been dismissed: the last player standing wins at once. The winner takes first place, and
          every other player shares second.
        </p>
        <p>
          There is no turn limit and no draw. A game ends only when someone indicts correctly or all but one
          player are out.
        </p>
      </Section>

      <Section id="board">
        <p>
          The board is a floor plan of {BOARD_SIZE} × {BOARD_SIZE} squares: {SCENES.length} rooms, the Rotunda
          in the middle, {DOORS.length} doors, {CORRIDOR.size} corridor squares and {ENTRANCES.length}{' '}
          Entrances.
        </p>
        {opening !== null && (
          <figure class="rfd-rules-figure" aria-hidden="true">
            <div class="rfd-board-wrap">
              <Board
                state={opening}
                targets={[]}
                onMove={undefined}
                expanded={false}
                names={THEME.parties.map((p) => p.role)}
              />
            </div>
            <figcaption>
              The board at the start of a game: every pawn on its Entrance, and a ring round the pawn whose
              turn it is.
            </figcaption>
          </figure>
        )}
        <ul>
          <li>
            <strong>Rooms.</strong> {andList(THEME.scenes)}. The corner rooms are{' '}
            {andList(CORNERS.map((room) => `the ${sceneName(room)}`))}.
          </li>
          <li>
            <strong>The Rotunda</strong> fills the middle of the building, where {THEME.verdict} is sealed. No
            pawn may enter it.
          </li>
          <li>
            <strong>Doors.</strong> A room is entered and left by its doors. Each door has a doorstep, the
            corridor square just outside it.
          </li>
          <li>
            <strong>{THEME.passage}s.</strong> Each joins a pair of corner rooms that lie diagonally opposite
            each other:{' '}
            {PASSAGES.map(([a, b]) => `the ${sceneName(a)} with the ${sceneName(b)}`).join(', and ')}.
          </li>
        </ul>
        <p>Each Party starts on its own Entrance. They are numbered clockwise from the top left.</p>
        <dl class="rules-terms">
          {THEME.parties.map((p, i) => (
            <Fragment key={p.monogram}>
              <dt>Entrance {i + 1}</dt>
              <dd>
                {p.door}: {p.name}, {p.role}
              </dd>
            </Fragment>
          ))}
        </dl>
      </Section>

      <Section id="online">
        <p>
          {THEME.title} is a slow, asynchronous game: every submission waits on the other players' answers in
          turn, so a game takes days. The cards are shuffled and dealt with cryptography, signed by every
          player before the first turn. Nobody, not even this site, can read a hand that is not their own, and
          nobody can read {THEME.verdict} until a player indicts. The players' apps do the mechanical steps by
          themselves, as long as the game is open in a window:
        </p>
        <ul>
          <li>
            <strong>Dice shares.</strong> Nobody types the dice. When you roll, every player's open app, yours
            included, adds its share to the roll, and the faces appear once the last share is in. The dice are
            always rolled live. A closed window stalls the roll, and the status line names whose app is next.
          </li>
          <li>
            <strong>Verdict shares.</strong> When a player indicts, the other players' open apps send their
            shares of {THEME.verdict} to the indicter without a click. Only the indicter can open it. The
            indicter's app then shows the three cards, to that player alone, and the indicter announces the
            outcome.
          </li>
          <li>
            <strong>Sealed shares.</strong> When you show a card, your app seals its share of that card for
            the submitter. After a wrong indictment another player may indict, and the first indicter's app
            then seals its share of {THEME.verdict} for the new indicter in the same way.
          </li>
          <li>
            <strong>Forced rebuttals.</strong> When you have only one possible answer to a submission, because
            you hold none of the three named cards or exactly one of them, your app sends it for you, without
            a click. With two or three of them you choose which to show.
          </li>
          <li>
            <strong>A shown card.</strong> Only the submitter sees which card it was. Everyone else sees that
            a card was shown, and by whom: a third player, or a spectator who joins late, cannot read the card
            or tell whether the same card was shown before.
          </li>
          <li>
            <strong>The Docket.</strong> Your private notes grid has a row for each of the {cards} cards and a
            column for each player. Your own cards (●) and the cards shown to you (✓) are marked for you. Tap
            any other box to mark it ✗, tap again for ?, and again to clear it. The marks stay in this
            browser, and every deduction is left to you. The public record of each submission and indictment
            sits below it.
          </li>
          <li>
            <strong>Enlarge board.</strong> The squares are small on a phone. Enlarge board draws the board
            bigger inside its frame, which you can scroll, and Fit board puts it back.
          </li>
          <li>
            <strong>Resign.</strong> Resign is not offered, at any number of players: giving up early would
            hand out the key to the hands, the shown cards and {THEME.verdict}. A player who cannot go on is
            timed out instead.
          </li>
          <li>
            <strong>Deadlines.</strong> Each turn has a deadline chosen with the table. Once it has passed,
            another player can claim a timeout, and every player who is holding the game up forfeits: one who
            has not moved or answered, or whose closed app owes a dice share, a share of {THEME.verdict} or a
            sealed share.
          </li>
          <li>
            <strong>The check.</strong> At the end every player's app reveals its key and the whole game is
            checked: every "none", every shown card and the outcome of every indictment. A false claim fails
            its player.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function RoomForDoubtRulesPage(props: { section: string | null }) {
  useEffect(() => {
    if (props.section === null) {
      window.scrollTo(0, 0);
      return;
    }
    const heading = document.getElementById(headingId(props.section));
    if (heading === null) return;
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  }, [props.section]);
  return <RoomForDoubtRulesContent />;
}
