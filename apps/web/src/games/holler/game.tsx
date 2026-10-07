/*
 * The Holler table. Card buttons submit a legal action as the engine listed it.
 * The active suit is a patterned control, present whenever the engine has named one.
 */
import { faceOf, type HollerState, type Phase } from '@bored-games/holler';
import { HOLLER_THEME } from '@bored-games/holler/theme';
import { useEffect, useState } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { ActiveSuit, CardBack, CardFace, SuitBadge, SuitMark } from './cards.tsx';
import { HOLLER_META } from './meta.ts';
import {
  buttonChoices,
  cardLabel,
  directionLabel,
  type PlayChoice,
  pendingLabels,
  playChoices,
  roundLabel,
  type SuitIndex,
  seatName,
  statusLine,
  suitLabel,
  suitLook,
  winnerLine,
} from './model.ts';
import './holler.css';

const theme = HOLLER_THEME;

function actingSeat(phase: Phase): number | null {
  switch (phase.type) {
    case 'name':
    case 'play':
    case 'drawn':
    case 'levy':
    case 'answer':
      return phase.seat;
    case 'cover':
    case 'catch':
      return phase.queue[0] ?? null;
    default:
      return null;
  }
}

function cardSuit(card: number): SuitIndex | null {
  return faceOf(card).suit;
}

function SuitButton(props: { play: PlayChoice; enabled: boolean; onAct: (action: unknown) => void }) {
  const look = props.play.suit === null ? null : suitLook(theme, props.play.suit);
  if (look === null) return null;
  return (
    <button
      type="button"
      class="holler-suit-btn"
      aria-label={props.play.label}
      data-suit={look.id}
      data-pattern={look.pattern}
      disabled={!props.enabled}
      onClick={() => props.onAct(props.play.action)}
    >
      <svg viewBox="0 0 36 48" aria-hidden="true">
        <SuitMark theme={theme} suit={look.index} />
      </svg>
      <span>{look.name}</span>
    </button>
  );
}

function HandCard(props: {
  card: number | null;
  drawn: boolean;
  plays: readonly PlayChoice[];
  enabled: boolean;
  onAct: (action: unknown) => void;
}) {
  if (props.card === null) {
    return (
      <div class="holler-slot" role="img" aria-label="Face down card">
        <CardBack theme={theme} />
      </div>
    );
  }
  const faceName = cardLabel(theme, props.card);
  const suit = cardSuit(props.card);
  const look = suit === null ? null : suitLook(theme, suit);
  const plain = props.plays.filter((play) => !play.holler);
  const hollers = props.plays.filter((play) => play.holler);
  const wild = props.plays.some((play) => play.suit !== null);
  const slot = props.drawn ? 'holler-slot holler-drawn' : 'holler-slot';
  if (wild) {
    return (
      <div class={slot}>
        <div role="img" aria-label={faceName}>
          <CardFace theme={theme} card={props.card} />
        </div>
        <div class="holler-suit-picks">
          {plain.map((play) => (
            <SuitButton key={play.label} play={play} enabled={props.enabled} onAct={props.onAct} />
          ))}
        </div>
        {hollers.map((play) => (
          <button
            key={play.label}
            type="button"
            class="btn holler-call"
            disabled={!props.enabled}
            aria-label={play.label}
            onClick={() => props.onAct(play.action)}
          >
            {theme.declaration}
          </button>
        ))}
      </div>
    );
  }
  const play = plain[0] ?? hollers[0];
  const holler = plain[0] !== undefined ? hollers[0] : undefined;
  const attrs = look === null ? {} : { 'data-suit': look.id, 'data-pattern': look.pattern };
  return (
    <div class={slot}>
      {play === undefined ? (
        <div role="img" aria-label={faceName} {...attrs}>
          <CardFace theme={theme} card={props.card} />
        </div>
      ) : (
        <button
          type="button"
          class="holler-card-btn"
          aria-label={play.label}
          disabled={!props.enabled}
          onClick={() => props.onAct(play.action)}
          {...attrs}
        >
          <CardFace theme={theme} card={props.card} />
        </button>
      )}
      {holler !== undefined && (
        <button
          type="button"
          class="btn holler-call"
          disabled={!props.enabled}
          aria-label={holler.label}
          onClick={() => props.onAct(holler.action)}
        >
          {theme.declaration}
        </button>
      )}
    </div>
  );
}

function Hand(props: {
  slots: HollerState['hands'][number];
  plays: readonly PlayChoice[];
  drawn: number | null;
  enabled: boolean;
  onAct: (action: unknown) => void;
}) {
  return (
    <div class="holler-hand" data-testid="holler-hand">
      {props.slots.map((slot) => (
        <HandCard
          key={slot.pos}
          card={slot.card}
          drawn={slot.pos === props.drawn}
          plays={props.plays.filter((play) => play.pos === slot.pos)}
          enabled={props.enabled}
          onAct={props.onAct}
        />
      ))}
    </div>
  );
}

export function HollerGame(props: GameViewProps) {
  const state = props.view.state as HollerState;
  const seq = props.view.head.seq;
  const [sentAt, setSentAt] = useState<number | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  const send = (action: unknown) => {
    setSentAt(seq);
    props.onAct(action).catch(() => setSentAt(null));
  };
  const plays = playChoices(theme, props.legal);
  const buttons = buttonChoices(theme, props.legal);
  const enabled = props.canAct && props.mySeat !== null && !props.busy && sentAt !== seq;
  const mine = props.mySeat === null ? undefined : state.hands[props.mySeat];
  const drawn = state.phase.type === 'drawn' ? state.phase.pos : null;
  const top = state.discard[state.discard.length - 1];
  const active = state.activeSuit === null ? null : suitLook(theme, state.activeSuit);
  const actor = actingSeat(state.phase);
  const status = statusLine(theme, state, props.names, props.mySeat);
  const winner = props.ended ? winnerLine(props.view.outcome, props.names) : null;
  const waiting = enabled ? [] : pendingLabels(theme, state.phase);

  return (
    <div class="holler-game" data-testid="holler-game" data-seq={seq} data-phase={state.phase.type}>
      <div class="holler-main">
        <section class="panel" aria-label="Table">
          <p class="holler-round">{roundLabel(state)}</p>
          <p class={enabled ? 'holler-status mine' : 'holler-status'} aria-live="polite">
            {winner ?? status}
          </p>
          <div class="holler-table">
            <div class="holler-pile" role="img" aria-label={`Draw pile, ${state.draw.length} cards`}>
              <CardBack theme={theme} />
              <span class="holler-count">{state.draw.length}</span>
            </div>
            {top === undefined ? (
              <div class="holler-discard-face" role="img" aria-label="Starter, face down">
                <CardBack theme={theme} />
              </div>
            ) : (
              <div
                class="holler-discard-face"
                role="img"
                aria-label={`Discard, ${cardLabel(theme, top.card)}`}
              >
                <CardFace theme={theme} card={top.card} />
                {active !== null && <SuitBadge theme={theme} suit={active.index} />}
              </div>
            )}
            {active !== null && <ActiveSuit theme={theme} suit={active.index} label={suitLabel(active)} />}
          </div>
          <p class="muted">
            {directionLabel(state.direction)}
            {state.buried.length > 0 ? `. Set aside ${state.buried.length}` : ''}
          </p>
        </section>
        {mine !== undefined && (
          <section class="panel" aria-label="Your hand">
            <h2>Your hand</h2>
            <Hand slots={mine} plays={plays} drawn={drawn} enabled={enabled} onAct={send} />
          </section>
        )}
        {(enabled ? buttons.length > 0 : waiting.length > 0) && winner === null && (
          <div class="holler-actions">
            {enabled
              ? buttons.map((button) => {
                  const look = button.suit === null ? null : suitLook(theme, button.suit);
                  const attrs = look === null ? {} : { 'data-suit': look.id, 'data-pattern': look.pattern };
                  return (
                    <button
                      key={button.label}
                      type="button"
                      class="btn btn-primary"
                      disabled={props.busy}
                      aria-label={button.label}
                      onClick={() => send(button.action)}
                      {...attrs}
                    >
                      {button.label}
                    </button>
                  );
                })
              : waiting.map((label) => (
                  <button key={label} type="button" class="btn" disabled>
                    {label}
                  </button>
                ))}
          </div>
        )}
        <section class="panel" aria-label="Other players">
          <div class="holler-opponents">
            {state.hands.map((hand, seat) =>
              seat === props.mySeat ? null : (
                <div key={seat} class="holler-opponent">
                  <span class="holler-pip" aria-hidden="true">
                    <CardBack theme={theme} />
                  </span>
                  <span>
                    <bdi>{seatName(props.names, seat)}</bdi>
                    <span class="holler-count"> {hand.length}</span>
                    {state.called[seat] === true ? ` ${theme.declaration}` : ''}
                  </span>
                </div>
              ),
            )}
          </div>
          {state.hands.map((hand, seat) =>
            seat === props.mySeat || !hand.some((slot) => slot.card !== null) ? null : (
              <div key={seat}>
                <h3>{seatName(props.names, seat)}</h3>
                <Hand slots={hand} plays={[]} drawn={null} enabled={false} onAct={send} />
              </div>
            ),
          )}
        </section>
      </div>
      <div class="holler-side">
        <section class="panel" aria-labelledby="holler-scores-h">
          <div class="panel-head">
            <h2 id="holler-scores-h">Scores</h2>
            <a class="btn btn-small" href={rulesHref(HOLLER_META.id)} target="_blank" rel="noopener">
              Rules<span class="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          {winner !== null && <p>{winner}</p>}
          {props.deadline !== undefined && winner === null && <p class="muted">{props.deadline}</p>}
          {props.notice !== undefined && <p class="muted">{props.notice}</p>}
          {!enabled && !props.ended && props.lockedReason !== '' && <p class="muted">{props.lockedReason}</p>}
          <ol class="holler-seats">
            {state.scores.map((score, seat) => (
              <li key={seat} class={actor === seat && !props.ended ? 'holler-seat to-play' : 'holler-seat'}>
                <span>{props.avatars[seat]}</span>
                <span>
                  <bdi>{seatName(props.names, seat)}</bdi>
                  {props.mySeat === seat ? ', you' : ''}
                  {state.called[seat] === true ? ` ${theme.declaration}` : ''}
                </span>
                <span class="holler-count">{score}</span>
              </li>
            ))}
          </ol>
          {props.onClaimTimeout !== undefined && props.timeoutExplanation !== undefined && (
            <button type="button" class="btn" disabled={props.busy} onClick={props.onClaimTimeout}>
              {props.timeoutExplanation}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
