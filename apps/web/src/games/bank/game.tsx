/*
 * The Bank table (D058). Faces appear only after the session has derived them. Show the dice publishes this
 * seat's part; it does not choose the faces.
 */
import type { BankState } from '@bored-games/bank';
import { BANK_THEME } from '@bored-games/bank/theme';
import { useEffect, useState } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { DicePair } from './dice.tsx';
import { BANK_META } from './meta.ts';
import {
  decisionButtons,
  dieClass,
  latestDice,
  latestRollId,
  pendingLabels,
  potWords,
  roundLabel,
  roundLog,
  SHOW_DICE,
  seatName,
  seatStatus,
  statusLine,
  winnerLine,
} from './model.ts';
import './bank.css';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

export function BankGame(props: GameViewProps) {
  const state = props.view.state as BankState;
  const pending = props.view.pending;
  const seq = props.view.head.seq;
  const reduced = useReducedMotion();
  const rollId = latestRollId(state.log);
  const [tumbling, setTumbling] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  useEffect(() => {
    setTumbling(rollId !== null && !reduced);
  }, [rollId, reduced]);

  const buttons = decisionButtons(props.legal);
  const myTurn = props.canAct && buttons.length > 0 && props.mySeat !== null && !props.busy && sentAt !== seq;
  const labels = myTurn ? buttons.map((b) => b.label) : pendingLabels(pending);
  const showing = labels.includes(BANK_THEME.decisions.contribute);
  const faces = latestDice(state.log);
  const words = potWords(state.log);
  const status = statusLine(state, props.names, props.mySeat, pending, props.ended);
  const winner = props.ended ? winnerLine(props.view.outcome, props.names) : null;
  const log = roundLog(state, props.names);

  const send = (action: unknown) => {
    setSentAt(seq);
    props.onAct(action).catch(() => setSentAt(null));
  };

  return (
    <div
      class="bank-game"
      data-testid="bank-game"
      data-seq={seq}
      data-pot={state.pot}
      data-round={state.round}
    >
      <section class="bank-main" aria-labelledby="bank-title">
        <h1 id="bank-title" class="sr-only">
          {BANK_THEME.title}
        </h1>
        <div class="bank-felt">
          <p class="bank-round">{roundLabel(state)}</p>
          <p class="bank-pot">
            <span class="sr-only">Pot </span>
            {state.pot}
          </p>
          <p class="bank-pot-change">{words ?? ''}</p>
          <DicePair
            faces={faces}
            rollId={rollId ?? state.nextRollId}
            className={dieClass(tumbling, reduced)}
            onSettled={() => setTumbling(false)}
          />
        </div>
      </section>
      <div class="bank-side">
        <section class="panel" aria-label="Status">
          <p class={myTurn ? 'bank-status mine' : 'bank-status'} aria-live="polite">
            {winner ?? status}
          </p>
          {winner !== null && (
            <p class="bank-winner" data-testid="bank-winner">
              {winner}
            </p>
          )}
          {props.deadline !== undefined && winner === null && <p class="muted">{props.deadline}</p>}
          {props.notice !== undefined && <p class="muted">{props.notice}</p>}
          {showing && <p class="hint">{SHOW_DICE}</p>}
          {labels.length > 0 && winner === null && (
            <div class="bank-actions">
              {myTurn
                ? buttons.map((button) => (
                    <button
                      key={button.label}
                      type="button"
                      class={`btn${button.label === BANK_THEME.decisions.roll || button.label === BANK_THEME.decisions.contribute ? ' btn-primary' : ''}`}
                      disabled={props.busy}
                      onClick={() => send(button.action)}
                    >
                      {button.label}
                    </button>
                  ))
                : labels.map((label) => (
                    <button key={label} type="button" class="btn" disabled>
                      {label}
                    </button>
                  ))}
            </div>
          )}
          {!myTurn && !props.ended && props.lockedReason !== '' && <p class="muted">{props.lockedReason}</p>}
          {props.onClaimTimeout !== undefined && props.timeoutExplanation !== undefined && (
            <button type="button" class="btn" disabled={props.busy} onClick={props.onClaimTimeout}>
              {props.timeoutExplanation}
            </button>
          )}
        </section>
        <section class="panel" aria-labelledby="bank-seats-h">
          <h2 id="bank-seats-h">Players</h2>
          <ol class="bank-seats">
            {state.scores.map((score, seat) => {
              const playing = pending.type === 'player' && pending.seat === seat && state.phase !== 'over';
              return (
                <li key={seat} class={playing ? 'bank-seat to-play' : 'bank-seat'}>
                  <span class="bank-seat-avatar">{props.avatars[seat]}</span>
                  <span class="bank-seat-name">
                    <bdi>{seatName(props.names, seat)}</bdi>
                    {props.mySeat === seat ? ', you' : ''}
                  </span>
                  <span class="bank-seat-score">
                    <span class="sr-only">Score </span>
                    {score}
                  </span>
                  <span class="bank-seat-state">{seatStatus(state, seat, pending)}</span>
                </li>
              );
            })}
          </ol>
        </section>
        <section class="panel" aria-labelledby="bank-log-h">
          <div class="panel-head">
            <h2 id="bank-log-h">This round</h2>
            <a class="btn btn-small" href={rulesHref(BANK_META.id)} target="_blank" rel="noopener">
              Rules<span class="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          {log.length === 0 ? (
            <p class="muted">No rolls yet.</p>
          ) : (
            <ul class="bank-log">
              {log.map((line, i) => (
                <li key={`${i}:${line}`}>{line}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
