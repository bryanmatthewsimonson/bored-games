/*
 * The Room for Doubt game screen (D078): the status line, the decisions of the moment (roll, passage, stay, end the
 * turn, the submission, the rebuttal, the Verdict's announcement, the indictment), the board with the targets of the
 * viewer's walk, the viewer's hand, the Docket and the players. Moves are sent only from the legal list. A rebuttal
 * with one possible answer is sent without a click (ruling 7), as Right of Way sends a forced sift. A shown card is
 * named only to the two seats it passed between (Review Focus 1); the session seals it, never this screen.
 */
import {
  passageTo,
  pawnOf,
  type RfdAction,
  type RfdState,
  roomOf,
  walkOf,
} from '@bored-games/room-for-doubt';
import { EMBLEMS } from '@bored-games/room-for-doubt/art';
import { ROOM_FOR_DOUBT_THEME as THEME } from '@bored-games/room-for-doubt/theme';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps, SetupCopy } from '../types.ts';
import { Board } from './board.tsx';
import { CardFace } from './cards.tsx';
import { Docket, LineText } from './docket.tsx';
import { IndictForm, SubmitForm } from './forms.tsx';
import { glyphUri } from './glyph-image.ts';
import {
  answerTo,
  cardAt,
  charge,
  choicesOf,
  forcedAnswer,
  handOf,
  type Line,
  ON_ACCENT,
  PALETTE,
  rollTotal,
  sceneName,
  seatName,
  shownByMe,
  shownName,
  statusLine,
  summonedTo,
  verdictRead,
} from './model.ts';
import './room-for-doubt.css';

/** The setup steps and the share owed out of turn, in this game's words (D060), for the registry. */
export const ROOM_FOR_DOUBT_SETUP_COPY: SetupCopy = {
  shuffling: 'Shuffling the case files',
  dealing: 'Dealing the cards and placing the exhibits…',
  share: { act: 'send a share of the Verdict', owed: 'a share of the Verdict' },
};

/** The status line, names in <bdi>. A game ended by a timeout or a forfeit has no winner in the state. */
export function StatusLine(props: {
  state: RfdState;
  names: readonly string[];
  me: number | null;
  ended?: boolean;
}) {
  const line: Line =
    props.ended === true && props.state.result === null
      ? ['The game has ended.']
      : statusLine(props.state, props.names, props.me);
  return (
    <p class="rfd-status" role="status" data-stage={props.state.stage}>
      <LineText line={line} />
    </p>
  );
}

export function RoomForDoubtGame(props: GameViewProps) {
  const s = props.view.state as RfdState | null;
  const legal = props.legal as readonly RfdAction[];
  const head = props.view.head.id;
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The head a move was sent at: the controls stay locked until the move lands or fails.
  const [sentAt, setSentAt] = useState<string | null>(null);
  const answeredAt = useRef<string | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  const enabled = props.canAct && !props.busy && sentAt !== head;

  const send = async (a: RfdAction): Promise<void> => {
    setError(null);
    setSentAt(head);
    try {
      await props.onAct(a);
    } catch (e) {
      setSentAt(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Ruling 7: a rebuttal with exactly one answer (none, or the one card this seat can show) is sent unasked.
  const forced = forcedAnswer(legal);
  useEffect(() => {
    if (forced === null || !enabled || answeredAt.current === head) return;
    answeredAt.current = head;
    void send(forced);
  });

  if (s === null) return <p>Setting up the game…</p>;

  const me = props.mySeat;
  const my = me === null ? undefined : s.players[me];
  const ended = props.ended || s.stage === 'over';
  const choices = choicesOf(legal);
  const pending = props.view.pending;
  const sub = s.submissions.at(-1);
  const indictment = s.indictments.at(-1);
  const room = me === null ? null : roomOf(pawnOf(s, me));
  const hand = handOf(s, me);
  const mine = new Set(hand.cards);
  const shown = shownByMe(s, me);
  const read = verdictRead(s, me);
  const answer = answerTo(s, me);
  const summoned = summonedTo(s, me);
  const passage = room === null ? null : passageTo(room);
  const walk = choices.moves.length > 0 ? walkOf(s) : null;
  const rebutting = choices.shows.length > 0 || choices.none !== null;
  const announcing = s.stage === 'verdict' && indictment !== undefined && indictment.by === me;
  const button = (a: RfdAction, label: string, primary = false) => (
    <button
      type="button"
      class={`btn rfd-btn${primary ? ' rfd-primary' : ''}`}
      data-action={JSON.stringify(a)}
      disabled={!enabled}
      onClick={() => void send(a)}
    >
      {label}
    </button>
  );

  return (
    <section
      class="rfd-game"
      aria-label={THEME.title}
      data-testid="rfd-game"
      data-stage={s.stage}
      data-turn={s.turn}
      data-seq={props.view.head.seq}
      data-pending-seat={pending.type === 'player' ? pending.seat : 'none'}
      data-my-seat={me ?? 'spectator'}
    >
      <header class="rfd-head">
        <StatusLine state={s} names={props.names} me={me} ended={props.ended} />
        <p class="rfd-meta">
          {props.deadline !== undefined && !ended && <span>{props.deadline}</span>}
          {props.notice !== undefined && <span>{props.notice}</span>}
          {/* Why a decision of this seat's is locked (still loading, an automatic step first), never mid-send. */}
          {legal.length > 0 && !props.canAct && !props.busy && !ended && props.lockedReason !== '' && (
            <span>{props.lockedReason}</span>
          )}
          <a href={rulesHref('room-for-doubt')}>Rules</a>
        </p>
      </header>

      <div class="rfd-table">
        <div class="rfd-main">
          {rebutting && sub !== undefined && me !== null && (
            <section class="rfd-panel rfd-rebut" aria-labelledby="rfd-rebut-title">
              <h3 id="rfd-rebut-title">Your answer</h3>
              <p>
                <LineText line={[{ name: seatName(props.names, sub.by) }, ` submitted ${charge(sub)}`]} />
              </p>
              <p class="rfd-note">
                {choices.shows.length > 0
                  ? `Show one of your cards. Only ${seatName(props.names, sub.by)} will see which.`
                  : 'You hold none of the three cards.'}
                {forced !== null ? ' Your only possible answer is being sent.' : ''}
              </p>
              <div class="rfd-answers">
                {choices.shows.map((marker) => {
                  const card = cardAt(s, me, marker.pos);
                  return (
                    <button
                      key={marker.pos}
                      type="button"
                      class="rfd-answer"
                      data-action={JSON.stringify(marker)}
                      disabled={!enabled}
                      aria-label={card === null ? 'Show this card' : `Show ${shownName(card)}`}
                      onClick={() => void send(marker)}
                    >
                      <CardFace card={card} />
                    </button>
                  );
                })}
                {choices.none !== null && button(choices.none, 'Say you have none', true)}
              </div>
            </section>
          )}

          {answer !== null && (
            <section class="rfd-panel rfd-shown" aria-labelledby="rfd-shown-title">
              {answer === 'unrebutted' ? (
                <h3 id="rfd-shown-title">Nobody could rebut your submission.</h3>
              ) : (
                <>
                  <h3 id="rfd-shown-title">
                    <LineText line={[{ name: seatName(props.names, answer.by) }, ' showed you']} />
                  </h3>
                  <CardFace card={answer.card} />
                </>
              )}
            </section>
          )}

          {announcing && (
            <section class="rfd-panel rfd-verdict" aria-labelledby="rfd-verdict-title">
              <h3 id="rfd-verdict-title">The Verdict</h3>
              {read === null ? (
                <p class="rfd-note">
                  The three cards appear here, to you alone, once the other players’ shares are in.
                </p>
              ) : (
                <ul class="rfd-cards" aria-label="The Verdict, as only you can see it">
                  {read.map((card) => (
                    <li key={card}>
                      <CardFace card={card} />
                    </li>
                  ))}
                </ul>
              )}
              {choices.verdict !== null &&
                button(
                  choices.verdict,
                  choices.verdict.upheld ? 'Announce: upheld' : 'Announce: dismissed',
                  true,
                )}
            </section>
          )}

          {choices.submits.length > 0 && room !== null && (
            <SubmitForm
              key={`${head}-submit`}
              room={room}
              actions={choices.submits}
              mine={mine}
              enabled={enabled}
              summoned={summoned !== null}
              onAct={(a) => void send(a)}
            />
          )}

          {(choices.roll !== null ||
            choices.stay !== null ||
            choices.passage !== null ||
            choices.endTurn !== null) && (
            <div class="rfd-actions">
              {choices.roll !== null && button(choices.roll, 'Roll the dice', true)}
              {choices.stay !== null && button(choices.stay, 'Stay: your pawn cannot move')}
              {choices.passage !== null &&
                passage !== null &&
                button(choices.passage, `Take the ${THEME.passage} to the ${sceneName(passage)}`)}
              {choices.endTurn !== null &&
                button(choices.endTurn, 'End your turn', choices.submits.length === 0)}
            </div>
          )}

          {walk !== null && (
            <p class="rfd-note rfd-walk">
              Choose a highlighted square or room on the board.
              {walk.shortfall
                ? ' No path uses the whole roll and none reaches a room, so the longest paths are offered.'
                : ''}
            </p>
          )}

          {error !== null && (
            <p class="rfd-error" role="alert">
              {error}
            </p>
          )}

          <div class="rfd-board-box">
            <div class="rfd-board-tools">
              <button
                type="button"
                class="btn rfd-btn"
                aria-pressed={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? 'Fit board' : 'Enlarge board'}
              </button>
              {s.dice !== null && (
                <p class="rfd-dice">
                  Dice:{' '}
                  {s.dice.map((d, k) => (
                    <span key={`${k}-${d}`} class="rfd-die">
                      {d}
                    </span>
                  ))}{' '}
                  = {rollTotal(s)}
                </p>
              )}
            </div>
            <div class="rfd-board-wrap">
              <Board
                state={s}
                targets={choices.moves}
                onMove={enabled ? (a) => void send(a) : undefined}
                expanded={expanded}
                names={props.names}
              />
            </div>
          </div>

          {choices.indicts.length > 0 && (
            <IndictForm actions={choices.indicts} mine={mine} enabled={enabled} onAct={(a) => void send(a)} />
          )}

          {my !== undefined && (
            <section class="rfd-panel" aria-labelledby="rfd-hand-title">
              <h3 id="rfd-hand-title">Your cards</h3>
              <ul class="rfd-hand">
                {hand.cards.map((card) => {
                  const to = shown.get(card);
                  return (
                    <li key={card}>
                      <CardFace
                        card={card}
                        note={
                          to === undefined
                            ? undefined
                            : `Shown to ${to.map((seat) => seatName(props.names, seat)).join(', ')}`
                        }
                      />
                    </li>
                  );
                })}
                {Array.from({ length: hand.hidden }, (_, k) => (
                  <li key={`hidden-${k}`}>
                    <CardFace card={null} />
                  </li>
                ))}
              </ul>
              {read !== null && !announcing && (
                <>
                  <h3>The Verdict you read</h3>
                  <ul class="rfd-cards">
                    {read.map((card) => (
                      <li key={card}>
                        <CardFace card={card} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <Docket key={props.view.rootId} state={s} me={me} rootId={props.view.rootId} names={props.names} />
        </div>

        <aside class="rfd-players" aria-label="Players">
          <ol class="rfd-player-list">
            {s.players.map((p, seat) => {
              const party = THEME.parties[p.party];
              const place = s.result?.places[seat];
              const turn = s.turn === seat && !ended;
              return (
                <li
                  key={party?.monogram ?? seat}
                  class={`rfd-player${turn ? ' rfd-player-turn' : ''}`}
                  data-seat={seat}
                >
                  {party !== undefined && (
                    <span
                      class="rfd-emblem"
                      style={{ '--rfd-band': PALETTE[party.accent] }}
                      title={party.name}
                    >
                      <img src={glyphUri(EMBLEMS[party.emblem], PALETTE[ON_ACCENT[party.accent]])} alt="" />
                    </span>
                  )}
                  <span class="rfd-player-body">
                    <span class="rfd-player-name">
                      {props.avatars[seat]}
                      <strong>
                        <bdi>{seatName(props.names, seat)}</bdi>
                      </strong>
                      {seat === me ? ' (you)' : ''}
                    </span>
                    <span class="rfd-player-party">
                      <span class="rfd-monogram">{party?.monogram}</span> {party?.name}
                    </span>
                    <span class="rfd-player-facts">
                      {p.hand.length} card{p.hand.length === 1 ? '' : 's'}
                      {turn ? ' · to play' : ''}
                      {p.dismissed ? ' · dismissed' : ''}
                    </span>
                  </span>
                  {place !== undefined && <span class="rfd-place">#{place}</span>}
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      {props.audit === 'pass' && (
        <p class="rfd-note" role="status">
          Deck audit passed.
        </p>
      )}
      {typeof props.audit === 'object' && (
        <p class="rfd-error" role="alert">
          Deck audit failed: {props.audit.reason}
        </p>
      )}
      {props.onClaimTimeout && (
        <ClaimTimeout
          busy={props.busy}
          onClaim={props.onClaimTimeout}
          explanation={props.timeoutExplanation ?? 'A player missed the deadline.'}
        />
      )}
    </section>
  );
}
