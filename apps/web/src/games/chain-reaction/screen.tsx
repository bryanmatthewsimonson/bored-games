/*
 * Chain Reaction in the generic game screen: the registry's component. It turns the session's module events into
 * the log and the last placed tile, and hands everything to `ChainReactionGame`.
 */
import type { ChainReactionAction, ChainReactionState } from '@bored-games/chain-reaction';
import { useMemo } from 'preact/hooks';
import type { GameViewProps } from '../types.ts';
import { ChainReactionGame } from './game.tsx';
import { lastTileOf, logLines } from './model.ts';
import { activeTheme } from './theme.ts';

export function ChainReactionScreen(props: GameViewProps) {
  const state = props.view.state as ChainReactionState;
  const { mySeat, names } = props;
  // The session's module events (oldest first, a new frozen array on every change): the log and the last tile.
  const events = props.view.events;
  const over = state.phase.kind === 'over';
  // The names in effect (D046): reading the signal re-renders this screen when the player changes them.
  const theme = activeTheme.value;
  const log = useMemo(
    () => logLines(events, { theme, mySeat, over, names }),
    [events, theme, mySeat, over, names],
  );
  const lastTile = useMemo(() => lastTileOf(events), [events]);
  return (
    <ChainReactionGame
      state={state}
      theme={theme}
      mySeat={mySeat}
      legal={props.legal as readonly ChainReactionAction[]}
      canAct={props.canAct}
      lockedReason={props.lockedReason}
      busy={props.busy}
      onAct={(a) => props.onAct(a)}
      names={names}
      avatars={props.avatars}
      events={log}
      lastTile={lastTile}
      audit={props.audit}
      notice={props.notice}
      deadline={props.deadline}
      onClaimTimeout={props.onClaimTimeout}
      timeoutExplanation={props.timeoutExplanation}
      ended={props.ended}
      outcome={props.view.outcome}
    />
  );
}
