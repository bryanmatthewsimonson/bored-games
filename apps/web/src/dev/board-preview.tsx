/*
 * Dev-only preview of the Chain Reaction screen (#/dev/board/<scene>). It renders the real component from
 * scripted full-mode engine games. It is a fixture for checking layout, not a play mode: submitting a form
 * only shows the action it would send.
 */
import { type ChainReactionAction, chainReaction, viewFor } from '@bored-games/chain-reaction';
import { useMemo, useState } from 'preact/hooks';
import { firstLegal, playUntil, randomLegal, type ScriptedGame } from '../games/chain-reaction/fixture.ts';
import { ChainReactionGame, logLines } from '../games/chain-reaction/index.ts';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

const pendingDecision = (g: ScriptedGame): string | null => {
  const p = chainReaction.pending(g.state);
  return p.type === 'player' ? p.decision : null;
};

const SCENES: Record<string, { label: string; build: () => ScriptedGame | null }> = {
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
  const seat = p.type === 'player' ? p.seat : 0;
  const legal = chainReaction.legalActions(game.state, seat) as ChainReactionAction[];
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
        state={viewFor(game.state, seat)}
        mySeat={seat}
        legal={legal}
        canAct={true}
        busy={false}
        onAct={setSent}
        names={NAMES}
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
