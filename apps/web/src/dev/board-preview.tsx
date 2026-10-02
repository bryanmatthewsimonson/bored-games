/*
 * Dev-only preview of the Chain Reaction screen (#/dev/board/<scene>). It renders the real component from
 * scripted full-mode engine games. It is a fixture for checking layout, not a play mode: submitting a form
 * only shows the action it would send.
 */
import {
  type ChainReactionAction,
  type ChainReactionState,
  chainReaction,
  viewFor,
} from '@bored-games/chain-reaction';
import { useMemo, useState } from 'preact/hooks';
import { Avatar } from '../components/avatar.tsx';
import { firstLegal, playUntil, randomLegal, type ScriptedGame } from '../games/chain-reaction/fixture.ts';
import { ChainReactionGame, logLines } from '../games/chain-reaction/index.ts';
import { playerNames } from '../screens/game.tsx';

/** Fixed seat keys, so the pattern avatars and short npubs are the same on every load. */
const KEYS = ['3b', '9e', 'c4', '71'].map((b) => b.repeat(32));
/** As the game screen shows them: a chosen name with the short npub, a long one, and one without a name. */
const NAMES = playerNames(KEYS, ['Ann', 'Bo', null, 'Dimitra Alexandropoulou-Smith']);
const AVATARS = KEYS.map((pk) => <Avatar key={pk} pubkey={pk} picture={null} />);

/** `s` with `seat`'s newest tile unknown, as a view shows a tile whose decryption shares are not all in. */
function hideNewest(s: ChainReactionState, seat: number): ChainReactionState {
  return {
    ...s,
    players: s.players.map((p, i) =>
      i === seat
        ? { ...p, hand: p.hand.map((h, j) => (j === p.hand.length - 1 ? { ...h, tile: null } : h)) }
        : p,
    ),
  };
}

const pendingDecision = (g: ScriptedGame): string | null => {
  const p = chainReaction.pending(g.state);
  return p.type === 'player' ? p.decision : null;
};

/**
 * The scenes. `hidden` watches the seat that just drew, with its newest tile hidden as when the other seats have
 * not all moved since the draw (the full-mode fixture knows every tile), to show the "?" tile and its popover.
 */
const SCENES: Record<string, { label: string; build: () => ScriptedGame | null; hidden?: boolean }> = {
  mid: {
    label: 'Mid-game placement',
    build: () =>
      playUntil(
        'preview',
        4,
        firstLegal,
        (g) => (g.state.turn?.number ?? 0) >= 24 && pendingDecision(g) === 'place',
      ),
  },
  merger: {
    label: 'Merger: disposal',
    build: () => playUntil('preview', 4, firstLegal, (g) => pendingDecision(g) === 'dispose'),
  },
  hidden: {
    label: 'Hidden new tile',
    hidden: true,
    build: () =>
      playUntil(
        'preview-hidden',
        4,
        randomLegal,
        (g) => (g.state.turn?.number ?? 0) >= 20 && pendingDecision(g) === 'place',
      ),
  },
  buy: {
    label: 'Buying shares',
    build: () =>
      playUntil(
        'preview-buy',
        4,
        randomLegal,
        (g) => (g.state.turn?.number ?? 0) >= 20 && pendingDecision(g) === 'endTurn',
      ),
  },
  over: {
    label: 'Game over',
    build: () => playUntil('preview-over', 4, randomLegal, (g) => g.state.phase.kind === 'over', 5000),
  },
};

export function BoardPreview(props: { scene: string }) {
  const scene = SCENES[props.scene] ? props.scene : 'mid';
  const game = useMemo(() => SCENES[scene]?.build() ?? null, [scene]);
  const [sent, setSent] = useState<ChainReactionAction | null>(null);
  if (!game) return <p>Could not build the "{scene}" scene.</p>;
  const p = chainReaction.pending(game.state);
  const hidden = SCENES[scene]?.hidden === true;
  const acting = p.type === 'player' ? p.seat : 0;
  // The hidden scene watches the seat that drew last, while the next seat places.
  const seat = hidden ? (acting + game.state.seats - 1) % game.state.seats : acting;
  const legal = chainReaction.legalActions(game.state, seat) as ChainReactionAction[];
  const view = viewFor(game.state, seat);
  return (
    <>
      <nav class="row" aria-label="Preview scenes">
        {Object.entries(SCENES).map(([id, s]) => (
          <a key={id} href={`#/dev/board/${id}`} aria-current={id === scene ? 'page' : undefined}>
            {s.label}
          </a>
        ))}
      </nav>
      <ChainReactionGame
        key={scene}
        state={hidden ? hideNewest(view, seat) : view}
        mySeat={seat}
        legal={legal}
        canAct={true}
        busy={false}
        onAct={setSent}
        names={NAMES}
        avatars={AVATARS}
        events={logLines(game.events, { mySeat: seat, over: game.state.phase.kind === 'over', names: NAMES })}
        lastTile={game.lastTile}
        audit={scene === 'over' ? 'pass' : undefined}
        deadline="23h 59m left"
      />
      {sent && (
        <section class="panel" aria-label="Submitted action">
          <code>{JSON.stringify(sent)}</code>
        </section>
      )}
    </>
  );
}
