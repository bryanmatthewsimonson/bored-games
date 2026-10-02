import type { ChainReactionAction, ChainReactionState } from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import { Board } from './board.tsx';
import { DecisionArea } from './decisions.tsx';
import { Hand } from './hand.tsx';
import { isLocked, submitUnderLock } from './lock.ts';
import {
  boardCells,
  chainRows,
  decisionFor,
  type HandTile,
  handTiles,
  playerRows,
  resultRows,
  statusLine,
} from './model.ts';
import { type Audit, ChainsPanel, EventLog, PlayersPanel, ResultsView, StatusBar } from './panels.tsx';
import { PriceCardDialog } from './price-card.tsx';
import './game.css';

export interface ChainReactionGameProps {
  /** The viewer's state: a view for a player or spectator, or a full state in fixtures. */
  state: ChainReactionState;
  mySeat: number | null;
  /** The viewer's legal actions in `state` (empty when it is not their decision). */
  legal: readonly ChainReactionAction[];
  /** False while the viewer may not act (out of turn, still syncing, signer unavailable). */
  canAct: boolean;
  /** Why the viewer may not act, shown above a disabled decision form. */
  lockedReason?: string | undefined;
  /** True while a submitted move is being signed and published. */
  busy: boolean;
  /** Submits a move. A rejected promise (or a throw) releases the controls so the player can retry. */
  onAct: (a: ChainReactionAction) => void | Promise<void>;
  /** Display name per seat. */
  names: readonly string[];
  /** Log lines, newest last. */
  events: readonly string[];
  /** The most recently placed tile, from the event log. */
  lastTile?: number | null | undefined;
  audit?: Audit | undefined;
  /** A protocol note for the status bar, such as "waiting for shares". */
  notice?: string | undefined;
  /** The current deadline, already formatted ("2h 14m left"). */
  deadline?: string | undefined;
  /** Shown as a button, with a confirm step, when a timeout may be claimed. */
  onClaimTimeout?: (() => void) | undefined;
  /** What the claim does (who forfeits), for the confirm step. */
  timeoutExplanation?: string | undefined;
  /** True once the game has ended outside the rules (a timeout): no tile is being revealed any more. */
  ended?: boolean | undefined;
}

export function ChainReactionGame(props: ChainReactionGameProps) {
  const { state, mySeat, names } = props;
  const [preview, setPreview] = useState<HandTile | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // The state seq a move was submitted from: the controls stay locked until the state moves on or the
  // controller reports the publish finished, so a double click can never send two moves.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [priceCardOpen, setPriceCardOpen] = useState(false);

  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  useEffect(() => {
    setSelected(null);
    setPreview(null);
  }, [state.seq]);

  const cells = useMemo(() => boardCells(state, props.lastTile ?? null), [state, props.lastTile]);
  const hand = useMemo(() => (mySeat === null ? [] : handTiles(state, mySeat)), [state, mySeat]);
  const decision = useMemo(() => decisionFor(state, props.legal), [state, props.legal]);
  const chains = chainRows(state, mySeat);
  const players = playerRows(state, names, mySeat);
  const status = statusLine(state, names, mySeat);
  const over = state.phase.kind === 'over';

  const lock = { canAct: props.canAct, busy: props.busy, sentAt, seq: state.seq };
  const locked = isLocked(lock);
  const submit = (a: ChainReactionAction): void => {
    submitUnderLock(a, lock, { setSentAt, onAct: props.onAct });
  };
  const lockNote =
    decision.kind === 'wait'
      ? ''
      : props.busy || (sentAt === state.seq && props.canAct)
        ? 'Sending your move…'
        : !props.canAct
          ? (props.lockedReason ?? 'You cannot act right now.')
          : '';
  const placeable = new Set(decision.kind === 'place' ? decision.options.map((o) => o.tile) : []);

  return (
    <div
      class="cr-game"
      data-testid="cr-game"
      data-seq={state.seq}
      data-turn={state.turn?.number ?? 0}
      data-phase={state.phase.kind}
    >
      <h1 class="sr-only">{CHAIN_REACTION_THEME.title}</h1>
      <StatusBar
        line={status}
        notice={props.notice}
        deadline={props.deadline}
        onClaimTimeout={props.onClaimTimeout}
        timeoutExplanation={props.timeoutExplanation}
        busy={props.busy}
      />
      <div class="cr-main">
        <Board cells={cells} preview={preview} />
        {mySeat !== null && !over && (
          <section class="cr-panel cr-hand-panel" aria-labelledby="cr-hand-h">
            <h2 id="cr-hand-h">Your tiles</h2>
            <Hand
              tiles={hand}
              placeable={placeable}
              showBadges={state.phase.kind === 'place'}
              selected={selected}
              disabled={locked}
              onSelect={setSelected}
              onPreview={setPreview}
              revealing={props.ended !== true}
            />
          </section>
        )}
        {over ? (
          <ResultsView rows={resultRows(state, names)} audit={props.audit} names={names} />
        ) : (
          mySeat !== null && (
            <section class="cr-panel cr-decision" aria-label="Your decision">
              {lockNote !== '' && (
                <p class="cr-hint cr-lock-note" role="note">
                  {lockNote}
                </p>
              )}
              <DecisionArea
                key={state.seq}
                decision={decision}
                waiting={status}
                locked={locked}
                hand={hand}
                selected={selected}
                onSelect={setSelected}
                submit={submit}
              />
            </section>
          )
        )}
      </div>
      <div class="cr-side">
        <nav class="cr-tools" aria-label="Game help">
          <button type="button" class="btn btn-small" onClick={() => setPriceCardOpen(true)}>
            Price card
          </button>
          {/* A new tab, so the running game here is not torn down and rebuilt. */}
          <a class="btn btn-small" href={rulesHref()} target="_blank" rel="noopener">
            Rules<span class="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
        <ChainsPanel rows={chains} spectator={mySeat === null} />
        <PlayersPanel rows={players} />
        <EventLog events={props.events} />
      </div>
      <PriceCardDialog
        open={priceCardOpen}
        onClose={() => setPriceCardOpen(false)}
        rules={state.rules}
        sizes={chains.map((r) => r.size)}
      />
    </div>
  );
}
