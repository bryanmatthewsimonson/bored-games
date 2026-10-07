/*
 * The Right of Way game screen: the board, the yard and piles, the viewer's hand and charters, and every
 * player's track and score. Moves are sent only from the legal list; a forced sift is sent automatically.
 */
import {
  CHARTER_OFFSET,
  CHARTERS,
  colorAt,
  ENGINE,
  ROUTES,
  type RowAction,
  type RowState,
} from '@bored-games/right-of-way';
import { RIGHT_OF_WAY_THEME } from '@bored-games/right-of-way/theme';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { CharterCard, FreightCard } from './art.tsx';
import { Board } from './board.tsx';
import {
  type Claim,
  cargoName,
  charterLines,
  charterTowns,
  claimsBySide,
  enginesIn,
  handCounts,
  lines,
  PLAYER_COLORS,
  payText,
  pileText,
  routeName,
  statusText,
} from './model.ts';
import './right-of-way.css';

export function RightOfWayGame(props: GameViewProps) {
  const s = props.view.state as RowState | null;
  const legal = props.legal as readonly RowAction[];
  const [picked, setPicked] = useState<string | null>(null);
  const [keep, setKeep] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sifted = useRef<string | null>(null);
  const enabled = props.canAct && !props.busy;

  const send = async (a: RowAction): Promise<void> => {
    setError(null);
    try {
      await props.onAct(a);
      setPicked(null);
      setKeep([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // A reshuffled card drawn blind has exactly one legal answer (keep or skip): send it for the player.
  const forcedSift = legal.length === 1 && legal[0]?.type === 'sift' ? legal[0] : null;
  useEffect(() => {
    if (forcedSift === null || !enabled) return;
    const key = `${props.view.head.id}`;
    if (sifted.current === key) return;
    sifted.current = key;
    void send(forcedSift);
  });

  const claims = useMemo(() => claimsBySide(legal), [legal]);
  const claimable = useMemo(() => new Set(enabled ? claims.keys() : []), [claims, enabled]);
  if (s === null) return <p>Setting up the game…</p>;

  const me = props.mySeat;
  const my = me === null ? undefined : s.players[me];
  const mine = me === null ? [] : charterLines(s, me);
  const marked = new Set<number>(
    mine.flatMap((c) => {
      const t = c.index === null ? undefined : CHARTERS[c.index];
      return t && !c.done ? [t.a, t.b] : [];
    }),
  );
  const keepActions = legal.filter((a): a is Extract<RowAction, { type: 'keep' }> => a.type === 'keep');
  const offered = my?.offered ?? [];
  const keepChoice = keepActions.find((a) => JSON.stringify(a.keep) === JSON.stringify(keep));
  const minKeep = keepActions.length > 0 ? Math.min(...keepActions.map((a) => a.keep.length)) : 0;
  const take = (slot: number) => legal.find((a) => a.type === 'take' && a.slot === slot);
  const blind = legal.find((a) => a.type === 'blind');
  const drawCharters = legal.find((a) => a.type === 'charters');
  const pass = legal.find((a) => a.type === 'pass');
  const options: Claim[] =
    picked === null ? [] : [...(claims.get(picked) ?? [])].sort((a, b) => enginesIn(s, a) - enginesIn(s, b));
  const pickedRoute = picked === null ? undefined : ROUTES[Number(picked.split(':')[0])];
  const counts = me === null ? [] : handCounts(s, me);
  const ended = props.ended || s.phase === 'over';
  const longest = lines(s);

  return (
    <section
      class="row-game"
      aria-label={RIGHT_OF_WAY_THEME.title}
      data-testid="row-game"
      data-turn={s.turn}
      data-phase={s.phase}
      data-seq={s.seq}
      data-my-seat={me ?? 'spectator'}
      data-starting-seat={s.startingSeat ?? 'pending'}
    >
      <header class="row-head">
        <p class="row-status" role="status" data-phase={s.phase}>
          {statusText(s, me, props.names, ended)}
        </p>
        <p class="row-meta">
          {props.deadline && <span>{props.deadline}</span>}
          {props.notice && <span>{props.notice}</span>}
          {!props.canAct && !ended && props.lockedReason && <span>{props.lockedReason}</span>}
          <a href={rulesHref('right-of-way')}>Rules</a>
        </p>
        {s.finalTurns !== null && !ended && <p class="row-final">Final round</p>}
      </header>

      <div class="row-table">
        <div class="row-main">
          <Board
            state={s}
            claimable={claimable}
            picked={picked}
            onPick={enabled ? (key) => setPicked(key) : undefined}
            marked={marked}
            names={props.names}
          />

          {picked !== null && pickedRoute && (
            <section class="row-panel row-claim" aria-labelledby="row-claim-title">
              <h3 id="row-claim-title">
                Lay track: {routeName(Number(picked.split(':')[0]))} · {pickedRoute.length} long
              </h3>
              <div class="row-options">
                {options.map((a) => (
                  <button
                    type="button"
                    key={JSON.stringify(a.pay)}
                    class="row-primary"
                    disabled={!enabled}
                    onClick={() => void send(a)}
                  >
                    Pay {payText(s, a)}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setPicked(null)}>
                Cancel
              </button>
            </section>
          )}

          {(s.phase === 'keep' || s.phase === 'charters') && s.turn === me && offered.length > 0 && (
            <section class="row-panel row-keep" aria-labelledby="row-keep-title">
              <h3 id="row-keep-title">
                Keep at least {minKeep} of these charter{offered.length === 1 ? '' : 's'}
              </h3>
              <p>Kept charters score their value if your track joins their towns, and lose it if not.</p>
              <div class="row-charters">
                {offered.map((c, i) => (
                  <label key={c.pos} class={`row-charter-pick ${keep.includes(i) ? 'row-picked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={keep.includes(i)}
                      disabled={!enabled || c.card === null}
                      onChange={() =>
                        setKeep((xs) =>
                          xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i].sort((x, y) => x - y),
                        )
                      }
                    />
                    <CharterCard index={c.card === null ? null : c.card - CHARTER_OFFSET} />
                    <span class="row-charter-towns">
                      {charterTowns(c.card === null ? null : c.card - CHARTER_OFFSET)}
                    </span>
                  </label>
                ))}
              </div>
              {offered.some((c) => c.card === null) && (
                <p class="row-note">Waiting for the other players' apps to reveal them to you…</p>
              )}
              <button
                type="button"
                class="row-primary"
                disabled={!enabled || keepChoice === undefined}
                onClick={() => keepChoice && void send(keepChoice)}
              >
                Keep {keep.length} charter{keep.length === 1 ? '' : 's'}
              </button>
            </section>
          )}

          <section class="row-panel row-draw" aria-label="Freight and charters">
            <div class="row-yard">
              {s.yard.map((y, slot) => {
                const color = y === null ? null : colorAt(s, y);
                const a = take(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    class="row-yard-card"
                    data-slot={slot}
                    data-color={color ?? ''}
                    disabled={!enabled || a === undefined}
                    aria-label={
                      y === null
                        ? 'Empty slot'
                        : color === null
                          ? 'Turning up a card…'
                          : `Take ${cargoName(color)}${color === ENGINE ? ' (wild, the whole draw)' : ''}`
                    }
                    onClick={() => a && void send(a)}
                  >
                    {y === null ? <span class="row-empty">Empty</span> : <FreightCard color={color} />}
                  </button>
                );
              })}
              <button
                type="button"
                class="row-pile"
                disabled={!enabled || blind === undefined}
                onClick={() => blind && void send(blind)}
                aria-label="Draw blind from the pile"
              >
                <FreightCard color={null} label="The pile" />
                <span>Draw blind</span>
              </button>
              <button
                type="button"
                class="row-pile"
                disabled={!enabled || drawCharters === undefined}
                onClick={() => drawCharters && void send(drawCharters)}
              >
                <CharterCard index={null} />
                <span>Draw charters ({s.charterPile.length})</span>
              </button>
            </div>
            <p class="row-note">
              {pileText(s)}
              {s.phase === 'draw' && s.turn === me ? ' · Take a second card (not a face-up Engine).' : ''}
              {forcedSift !== null ? ' · Drawing from the reshuffled pile…' : ''}
            </p>
            {pass && (
              <button type="button" disabled={!enabled} onClick={() => void send(pass)}>
                Pass: nothing else is possible
              </button>
            )}
            {enabled && claims.size > 0 && picked === null && (
              <p class="row-note">Or pick a highlighted route on the board to lay track.</p>
            )}
            {error && (
              <p class="row-error" role="alert">
                {error}
              </p>
            )}
          </section>

          {my && (
            <section class="row-panel row-hand" aria-labelledby="row-hand-title" data-seat={me}>
              <h3 id="row-hand-title">Your freight</h3>
              <ul class="row-counts">
                {counts.map((n, c) =>
                  n === 0 ? null : (
                    <li key={c} data-color={c} data-count={n}>
                      <FreightCard color={c} />
                      <b>×{n}</b>
                    </li>
                  ),
                )}
                {my.hand.some((h) => h.card === null) && (
                  <li class="row-note">A card is being revealed to you…</li>
                )}
                {my.hand.length === 0 && <li class="row-note">No freight cards.</li>}
              </ul>
              <h3>Your charters</h3>
              <ul class="row-charters">
                {mine.map((c) => (
                  <li key={c.pos} data-done={c.done}>
                    <CharterCard index={c.index} done={c.done} />
                    <span class="row-charter-towns">{charterTowns(c.index)}</span>
                    <span>{c.done ? 'Completed' : 'Open'}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside class="row-players" aria-label="Players">
          {s.players.map((p, seat) => {
            const place = s.result?.places[seat];
            return (
              <article
                key={seat}
                class={`row-player ${s.turn === seat && !ended ? 'row-player-active' : ''}`}
                data-seat={seat}
              >
                <div class="row-player-head">
                  <span class="row-swatch" style={{ background: PLAYER_COLORS[seat] }} aria-hidden="true" />
                  {props.avatars[seat]}
                  <strong>
                    {props.names[seat] ?? `Player ${seat + 1}`}
                    {seat === me ? ' (you)' : ''}
                  </strong>
                  {place !== undefined && <span class="row-place">#{place}</span>}
                </div>
                <dl>
                  <dt>Score</dt>
                  <dd data-score>{s.result?.scores[seat] ?? p.points}</dd>
                  <dt>Track left</dt>
                  <dd>{p.track}</dd>
                  <dt>Freight</dt>
                  <dd>{p.hand.length}</dd>
                  <dt>Charters</dt>
                  <dd>{p.charters.length}</dd>
                  <dt>Longest line</dt>
                  <dd>{longest[seat]}</dd>
                </dl>
                {ended && (
                  <ul class="row-charters row-final-charters">
                    {charterLines(s, seat).map((c) => (
                      <li key={c.pos} data-done={c.done}>
                        {c.from} – {c.to}: {c.done ? '+' : '−'}
                        {c.value}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </aside>
      </div>

      {props.audit === 'pass' && (
        <p class="row-note" role="status">
          Deck audit passed.
        </p>
      )}
      {typeof props.audit === 'object' && (
        <p class="row-error" role="alert">
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
