import type { ChainReactionAction, ChainReactionState } from '@bored-games/chain-reaction';
import type { ChainReactionTheme } from '@bored-games/chain-reaction/theme';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useReducer, useState } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import { Board } from './board.tsx';
import { DecisionArea } from './decisions.tsx';
import { Hand, TIP_CLOSED, type TipEvent, tipReducer } from './hand.tsx';
import { isLocked, submitUnderLock } from './lock.ts';
import { CHAIN_REACTION_META } from './meta.ts';
import {
  boardCells,
  chainRows,
  decisionFor,
  type HandTile,
  handBadgesShown,
  handTiles,
  myHoldings,
  playerRows,
  resultRows,
  statusLine,
} from './model.ts';
import {
  type Audit,
  ChainsPanel,
  EventLog,
  HoldingsPanel,
  PlayersPanel,
  ResultsView,
  StatusBar,
} from './panels.tsx';
import { PriceCardDialog } from './price-card.tsx';
import './game.css';

export interface ChainReactionGameProps {
  /** The viewer's state: a view for a player or spectator, or a full state in fixtures. */
  state: ChainReactionState;
  /** The names and looks in effect (D046). */
  theme: ChainReactionTheme;
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
  /** An avatar per seat, shown beside the name in the Players panel and the results (optional). */
  avatars?: readonly ComponentChildren[] | undefined;
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
  /** True once the game has ended outside the rules (a timeout): a hidden tile will never be revealed. */
  ended?: boolean | undefined;
}

export function ChainReactionGame(props: ChainReactionGameProps) {
  const { state, theme, mySeat, names } = props;
  const [preview, setPreview] = useState<HandTile | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // The state seq a move was submitted from: the controls stay locked until the state moves on or the
  // controller reports the publish finished, so a double click can never send two moves.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [priceCardOpen, setPriceCardOpen] = useState(false);
  const [tip, onTip] = useReducer<typeof TIP_CLOSED, TipEvent>(tipReducer, TIP_CLOSED);

  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  useEffect(() => {
    setSelected(null);
    setPreview(null);
  }, [state.seq]);
  // An open "?" popover closes on Escape wherever the focus is (a hover popover too, WCAG 1.4.13), and a pinned
  // one on a tap or click anywhere else (touch browsers may not move the focus on a tap).
  const tipOpen = tip.pos !== null;
  useEffect(() => {
    if (!tipOpen) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.cr-unknown'))) onTip({ type: 'close' });
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onTip({ type: 'close' });
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', onEscape);
    };
  }, [tipOpen]);

  const cells = useMemo(
    () => boardCells(theme, state, props.lastTile ?? null),
    [theme, state, props.lastTile],
  );
  const hand = useMemo(
    () => (mySeat === null ? [] : handTiles(theme, state, mySeat)),
    [theme, state, mySeat],
  );
  const decision = useMemo(() => decisionFor(theme, state, props.legal), [theme, state, props.legal]);
  // The "?" popover stays open while other seats move, and closes once its tile is revealed.
  useEffect(() => {
    if (tip.pos !== null && !hand.some((t) => t.pos === tip.pos && t.tile === null)) onTip({ type: 'close' });
  }, [hand, tip.pos]);
  const chains = chainRows(theme, state, mySeat);
  const players = playerRows(theme, state, names, mySeat);
  const status = statusLine(theme, state, names, mySeat);
  const over = state.phase.kind === 'over';
  // Hidden for a spectator, and once the game is over: the results then give every player's final cash.
  const holdings = over ? null : myHoldings(theme, state, mySeat);

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
      <h1 class="sr-only">{theme.title}</h1>
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
              showBadges={handBadgesShown(decision)}
              selected={selected}
              disabled={locked}
              onSelect={setSelected}
              onPreview={setPreview}
              ended={props.ended === true}
              tip={tip}
              onTip={onTip}
            />
          </section>
        )}
        {holdings !== null && <HoldingsPanel holdings={holdings} />}
        {over ? (
          <ResultsView
            rows={resultRows(state, names)}
            audit={props.audit}
            names={names}
            avatars={props.avatars}
          />
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
          <a class="btn btn-small" href={rulesHref(CHAIN_REACTION_META.id)} target="_blank" rel="noopener">
            Rules<span class="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
        <ChainsPanel rows={chains} spectator={mySeat === null} />
        <PlayersPanel rows={players} avatars={props.avatars} />
        <EventLog events={props.events} />
      </div>
      <PriceCardDialog
        open={priceCardOpen}
        onClose={() => setPriceCardOpen(false)}
        rules={state.rules}
        theme={theme}
        sizes={chains.map((r) => r.size)}
      />
    </div>
  );
}
