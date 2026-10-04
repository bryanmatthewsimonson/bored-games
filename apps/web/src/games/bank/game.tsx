/*
 * The Bank table (D058). Faces appear once every open window has published its share of the public roll.
 * Nobody chooses the faces, and there is no tap to reveal them.
 */
import type { BankState } from '@bored-games/bank';
import { BANK_THEME } from '@bored-games/bank/theme';
import { useEffect, useState } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { DicePair } from './dice.tsx';
import { BANK_META } from './meta.ts';
import {
  actionClass,
  decisionButtons,
  dieClass,
  latestDice,
  latestRollId,
  pendingLabels,
  potTone,
  potWords,
  rollCountLabel,
  rollGuide,
  roundLabel,
  roundLog,
  safeMarks,
  safeRollNote,
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
  // A roll in flight: engine 0.1.0 collects contributions as turns; engine 0.2.0 pends the beacon at once while
  // every seat's contribution arrives as a roll Shares event (PROTOCOL-v2 §6.2).
  const rolling =
    pending.type === 'beacon' || (pending.type === 'player' && pending.decision === 'contribute');
  const labels = myTurn ? buttons.map((b) => b.label) : pendingLabels(pending);
  const faces = latestDice(state.log);
  const words = potWords(state.log);
  const tone = potTone(state.log);
  const count = rollCountLabel(state);
  const note = safeRollNote(state);
  const marks = safeMarks(state);
  const guide = rollGuide(state);
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
          {count !== null && (
            <p class="bank-roll" data-testid="bank-roll">
              {count}
            </p>
          )}
          {note !== null && marks !== null && (
            <p class="bank-safe" data-testid="bank-safe">
              <span class="bank-safe-marks" aria-hidden="true">
                {marks.map((used, i) => (
                  <span key={i} class={used ? 'bank-mark used' : 'bank-mark'}>
                    {i + 1}
                  </span>
                ))}
              </span>
              {note}
            </p>
          )}
          <p class="bank-pot">
            <span class="sr-only">Pot </span>
            {state.pot}
          </p>
          <p class={tone === null ? 'bank-pot-change' : `bank-pot-change ${tone}`}>{words ?? ''}</p>
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
          {!rolling && props.notice !== undefined && <p class="muted">{props.notice}</p>}
          {guide !== null && winner === null && (
            <section
              class="bank-guide"
              data-testid="bank-guide"
              data-safe={guide.safe ? 'true' : 'false'}
              aria-labelledby="bank-guide-h"
            >
              <h3 id="bank-guide-h">{guide.headline}</h3>
              <p class="bank-guide-summary">{guide.summary}</p>
              {guide.bankLine !== null && <p class="bank-guide-bank">{guide.bankLine}</p>}
              <table class="bank-chances">
                <caption class="sr-only">
                  What the dice can do to the pot, out of 36 equally likely rolls
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Dice</th>
                    <th scope="col">Result</th>
                    <th scope="col">Chance</th>
                  </tr>
                </thead>
                <tbody>
                  {guide.chances.map((chance) => (
                    <tr key={chance.label} class={chance.tone}>
                      <th scope="row">{chance.label}</th>
                      <td>{chance.effect}</td>
                      <td>{chance.ways} of 36</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {labels.length > 0 && winner === null && (
            <div class="bank-actions">
              {myTurn
                ? buttons.map((button) => (
                    <button
                      key={button.label}
                      type="button"
                      class={actionClass(button.label, labels.length === 1)}
                      disabled={props.busy}
                      onClick={() => send(button.action)}
                    >
                      {button.label}
                    </button>
                  ))
                : labels.map((label) => (
                    <button
                      key={label}
                      type="button"
                      class={actionClass(label, labels.length === 1)}
                      disabled
                    >
                      {label}
                    </button>
                  ))}
            </div>
          )}
          {!rolling && !myTurn && !props.ended && props.lockedReason !== '' && (
            <p class="muted">{props.lockedReason}</p>
          )}
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
              const playing =
                pending.type === 'player' && pending.seat === seat && state.phase !== 'over' && !rolling;
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
