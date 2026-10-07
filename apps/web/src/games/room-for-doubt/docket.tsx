/*
 * The Docket (D078; RULES.md "Interface notes"): the player's private notes, a row per card and a column per seat.
 * The automatic marks are what this seat has seen: its own hand, and each card shown to it, in the shower's column.
 * A tap on any other cell cycles blank → ✗ → ? → blank; the marks stay in this browser, per profile and game.
 * Every deduction is left to the player. The public record of submissions and indictments sits below the grid.
 */
import type { RfdState } from '@bored-games/room-for-doubt';
import { ROOM_FOR_DOUBT_THEME as THEME } from '@bored-games/room-for-doubt/theme';
import { useState } from 'preact/hooks';
import { useApp } from '../../context.ts';
import { readJson, storageKey, writeJson } from '../../storage.ts';
import { glyphUri } from './glyph-image.ts';
import {
  type AutoMark,
  type CardKind,
  cardLook,
  type DocketRow,
  docketRows,
  type Line,
  type ManualMark,
  markKey,
  nextMark,
  PALETTE,
  parseMarks,
  recordItems,
  seatName,
} from './model.ts';

/** A line with each player's name isolated in <bdi>, so a name in another script cannot reorder the sentence. */
export function LineText(props: { line: Line }) {
  return <>{props.line.map((p, i) => (typeof p === 'string' ? p : <bdi key={i}>{p.name}</bdi>))}</>;
}

/** A record line's key: the submission or the indictment it describes (`recordItems` lists them in that order). */
const recordKey = (s: RfdState, k: number): string =>
  k < s.submissions.length ? `submission-${k}` : `indictment-${k - s.submissions.length}`;

const GROUPS: readonly { kind: CardKind; title: string }[] = [
  { kind: 'party', title: 'Parties' },
  { kind: 'exhibit', title: 'Exhibits' },
  { kind: 'scene', title: 'Scenes' },
];

const AUTO: Readonly<Record<AutoMark, { symbol: string; words: string }>> = {
  held: { symbol: '●', words: 'in your hand' },
  shown: { symbol: '✓', words: 'shown to you' },
};

const MANUAL: Readonly<Record<ManualMark, { symbol: string; words: string }>> = {
  x: { symbol: '✗', words: 'marked ✗' },
  '?': { symbol: '?', words: 'marked ?' },
};

function Cell(props: {
  row: DocketRow;
  who: string;
  auto: AutoMark | null;
  mark: ManualMark | null;
  onTap: () => void;
}) {
  if (props.auto !== null) {
    const a = AUTO[props.auto];
    return (
      <td class={`rfd-mark rfd-mark-${props.auto}`}>
        <span aria-hidden="true">{a.symbol}</span>
        <span class="sr-only">
          {props.row.name}, {props.who}: {a.words}
        </span>
      </td>
    );
  }
  const m = props.mark === null ? null : MANUAL[props.mark];
  return (
    <td>
      <button
        type="button"
        class="rfd-cell"
        aria-label={`${props.row.name}, ${props.who}: ${m === null ? 'no mark' : m.words}`}
        onClick={props.onTap}
      >
        {m?.symbol ?? ''}
      </button>
    </td>
  );
}

export function Docket(props: {
  state: RfdState;
  me: number | null;
  rootId: string;
  names: readonly string[];
}) {
  const { store, profile } = useApp();
  const key = storageKey(profile, `rfd-docket:${props.rootId}`);
  const [marks, setMarks] = useState<Record<string, ManualMark>>(() => parseMarks(readJson(store, key)));
  const s = props.state;
  const rows = docketRows(s, props.me);
  const tap = (card: number, seat: number) => {
    const k = markKey(card, seat);
    const m = nextMark(marks[k] ?? null);
    const next = Object.fromEntries([
      ...Object.entries(marks).filter(([other]) => other !== k),
      ...(m === null ? [] : [[k, m]]),
    ]) as Record<string, ManualMark>;
    setMarks(next);
    writeJson(store, key, next);
  };
  const who = (seat: number): string => (seat === props.me ? 'you' : seatName(props.names, seat));
  const lines = recordItems(s, props.names);
  return (
    <section class="rfd-panel rfd-docket" aria-labelledby="rfd-docket-title">
      <h3 id="rfd-docket-title">Docket</h3>
      <p class="rfd-note">
        {props.me === null
          ? 'Your private notes. Tap a box to mark it ✗, then ?, then clear it.'
          : 'Your private notes. ● your own card, ✓ a card shown to you. Tap a box to mark it ✗, then ?, then clear it.'}
      </p>
      <div class="rfd-docket-frame">
        <table class="rfd-docket-grid">
          <thead>
            <tr>
              <th scope="col">
                <span class="sr-only">Card</span>
              </th>
              {s.players.map((p, seat) => (
                <th
                  key={seat}
                  scope="col"
                  class={seat === props.me ? 'rfd-docket-me' : undefined}
                  title={seatName(props.names, seat)}
                >
                  <span aria-hidden="true">{THEME.parties[p.party]?.monogram ?? seat + 1}</span>
                  <span class="sr-only">{seat === props.me ? 'You' : seatName(props.names, seat)}</span>
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((g) => (
            <tbody key={g.kind}>
              <tr class="rfd-docket-group">
                <th scope="rowgroup" colSpan={s.players.length + 1}>
                  {g.title}
                </th>
              </tr>
              {rows
                .filter((r) => r.kind === g.kind)
                .map((row) => {
                  const look = cardLook(row.card);
                  return (
                    <tr key={row.card}>
                      <th scope="row">
                        {look !== null && (
                          <img
                            class="rfd-docket-glyph"
                            src={glyphUri(look.glyph, PALETTE.ink)}
                            alt=""
                            width={20}
                            height={20}
                          />
                        )}
                        {row.name}
                      </th>
                      {row.marks.map((auto, seat) => (
                        <Cell
                          key={seat}
                          row={row}
                          who={who(seat)}
                          auto={auto}
                          mark={marks[markKey(row.card, seat)] ?? null}
                          onTap={() => tap(row.card, seat)}
                        />
                      ))}
                    </tr>
                  );
                })}
            </tbody>
          ))}
        </table>
      </div>
      <h3 id="rfd-record-title">Record</h3>
      {lines.length === 0 && <p class="rfd-note">No submissions yet.</p>}
      <ol class="rfd-record" aria-labelledby="rfd-record-title">
        {lines.map((line, k) => (
          <li key={recordKey(s, k)}>
            <LineText line={line} />
          </li>
        ))}
      </ol>
    </section>
  );
}
