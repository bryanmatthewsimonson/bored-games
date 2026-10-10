import {
  BASE,
  CARDS,
  type GiltAction,
  type GiltState,
  giltAndGuile,
  KINDS,
  type Kind,
  kindOf,
  scores,
} from '@bored-games/gilt-and-guile';
import { CARD_NAMES, CARD_TEXT, GILT_AND_GUILE_THEME } from '@bored-games/gilt-and-guile/theme';
import { useRef, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import type { GameViewProps } from '../types.ts';
import { StageArt } from './art.tsx';
import { Card } from './cards.tsx';
import './gilt-and-guile.css';

const TASK_COPY: Record<string, string> = {
  rehearsal: 'Choose cards to discard, then finish to draw replacements.',
  trash: 'Choose a card in your hand to trash.',
  gain: 'Choose an eligible card from the supply.',
  attack: 'A rival makes their move. Reveal Understudy to block, or accept the attack.',
  discard: 'Choose the required cards to discard.',
  top: 'Choose a card to put on top of your deck.',
  repeat: 'Choose an action from your hand to play twice, or skip.',
  booking: 'Show a victory card to put on your deck, or reveal your hand if you have none.',
  headliner: 'Trash one revealed treasure other than a Penny.',
  busker: 'Play the revealed action without spending an action, or discard it.',
  stagedoor: 'Trash any inspected cards, then discard any. Return the rest bottom first.',
  readchoice: 'Keep the card, or set it aside if it is an action.',
  action: 'Play an action card, or move on to treasures.',
  treasure: 'Play treasures from your hand to collect coins.',
  buy: 'Choose a supply card to buy, or end your turn.',
};
export function GiltAndGuileGame(props: GameViewProps) {
  const s = props.view.state as GiltState;
  const [selected, setSelected] = useState<{ kind: Kind; action: GiltAction | undefined } | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const legal = props.legal as readonly GiltAction[];
  const pd = giltAndGuile.pending(s);
  const actor = pd.type === 'player' ? pd.seat : s.turn;
  const enabled = props.canAct && !props.busy && !sending && !props.ended;
  const me = props.mySeat === null ? null : s.players[props.mySeat]!;
  const points = scores(s);
  const decision = pd.type === 'player' ? pd.decision : '';
  const send = async (a: GiltAction) => {
    if (!enabled) return;
    setSending(true);
    setError('');
    try {
      await props.onAct(a);
      dialog.current?.close();
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your move could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };
  const inspect = (kind: Kind, action?: GiltAction) => {
    setSelected({ kind, action });
    dialog.current?.showModal();
  };
  const buttonAction = (type: string) => legal.find((a) => a.type === type);
  const simple = (type: string, label: string, primary = false) => {
    const a = buttonAction(type);
    return a ? (
      <button
        type="button"
        class={primary ? 'gg-primary' : 'gg-secondary'}
        disabled={!enabled}
        onClick={() => void send(a)}
      >
        {label}
      </button>
    ) : null;
  };
  const status = props.ended
    ? s.result
      ? `${s.result.places.flatMap((p, i) => (p === 1 ? [props.names[i] ?? `Player ${i + 1}`] : [])).join(' & ')} wins!`
      : 'The game has ended.'
    : pd.type === 'shuffle'
      ? 'Shuffling your company deck…'
      : pd.type === 'reveal'
        ? 'Revealing the new card…'
        : actor === props.mySeat
          ? 'Your turn'
          : `${props.names[actor] ?? `Player ${actor + 1}`}'s turn`;
  return (
    <section class="gg-game" aria-label="Gilt & Guile game table">
      <header class="gg-masthead">
        <div class="gg-brandmark" aria-hidden="true">
          ✧
        </div>
        <div>
          <p class="gg-eyebrow">FORTUNE FAVOURS THE THEATRICAL</p>
          <h1>{GILT_AND_GUILE_THEME.title}</h1>
          <p>{GILT_AND_GUILE_THEME.tagline}</p>
        </div>
        <div class="gg-table-meta">
          <span>THE COMPANY SUPPLY</span>
          <small>
            {s.seats} players · Turn {s.players.reduce((n, p) => n + p.turns, 0) + 1}
          </small>
          <a href="#/rules/gilt-and-guile">How to play ↗</a>
        </div>
        <div class="gg-masthead-art">
          <StageArt panorama />
        </div>
      </header>
      <div class="gg-layout">
        <div class="gg-board">
          <section class="gg-status" aria-live="polite">
            <span class="gg-turn-dot" />
            <div>
              <strong>{status}</strong>
              <p>
                {props.notice ??
                  (props.ended
                    ? 'The curtain falls. Your company takes its final bow.'
                    : (TASK_COPY[decision] ?? 'The table will continue when the cards are ready.'))}
              </p>
            </div>
            <div class="gg-phase-track">
              {['action', 'treasure', 'buy'].map((phase, i) => (
                <span key={phase} class={s.phase === phase ? 'current' : ''}>
                  <b>{i + 1}</b>
                  {phase}
                </span>
              ))}
            </div>
          </section>
          <div class="gg-section-title">
            <h2>The company supply</h2>
            <span>
              THE COMPANY SUPPLY <i>•</i> 10 selected piles
            </span>
          </div>
          <section class="gg-market" aria-label="Action card supply">
            {s.kingdom.map((kind) => {
              const a = legal.find((a) => (a.type === 'buy' || a.type === 'gain') && a.kind === kind);
              return (
                <Card
                  key={kind}
                  kind={kind}
                  count={s.supply[kind].length}
                  available={enabled && !!a}
                  onClick={() => inspect(kind, a)}
                />
              );
            })}
          </section>
          <div class="gg-section-title gg-base-title">
            <h2>Funding & acclaim</h2>
            <span>Coins build your engine. Acclaim wins the game.</span>
          </div>
          <section class="gg-base" aria-label="Resource and landmark supply">
            {BASE.map((kind) => {
              const a = legal.find((a) => (a.type === 'buy' || a.type === 'gain') && a.kind === kind);
              return (
                <Card
                  key={kind}
                  kind={kind}
                  compact
                  count={s.supply[kind].length}
                  available={enabled && !!a}
                  onClick={() => inspect(kind, a)}
                />
              );
            })}
          </section>
          <section class="gg-play-area" aria-label="Cards in play">
            <div class="gg-section-title">
              <h2>In play</h2>
              <span>{s.players[s.turn]!.played.length} cards</span>
            </div>
            <div class="gg-played">
              {s.players[s.turn]!.played.length ? (
                s.players[s.turn]!.played.map((c) =>
                  c.card !== null ? (
                    <button type="button" key={c.pos} onClick={() => inspect(kindOf(c.card as number))}>
                      <span>✧</span>
                      {CARD_NAMES[kindOf(c.card)]}
                    </button>
                  ) : null,
                )
              ) : (
                <p>Your next great idea starts with a single card.</p>
              )}
            </div>
          </section>
          {enabled && s.tasks.length > 0 && (
            <section class="gg-choices" aria-label="Card effect choices">
              <h3>Resolve the card</h3>
              <p>
                {TASK_COPY[decision]} {s.tasks[0]?.type === 'stagedoor' ? `Step: ${s.tasks[0].phase}.` : ''}
              </p>
              <div class="gg-choice-row">
                {legal
                  .filter(
                    (a) =>
                      'pos' in a &&
                      (['put', 'keep', 'aside', 'peektrash', 'peekdiscard', 'busk'].includes(a.type) ||
                        (a.type === 'top' && s.tasks[0]?.type === 'top' && s.tasks[0].source === 'discard')),
                  )
                  .map((a) => {
                    if (!('pos' in a)) return null;
                    const card =
                      'card' in a
                        ? a.card
                        : [...(me?.peek ?? []), ...(me?.hand ?? [])].find((c) => c.pos === a.pos)?.card;
                    return (
                      <button
                        type="button"
                        class="gg-secondary"
                        key={`${a.type}-${a.pos}`}
                        onClick={() => void send(a)}
                      >
                        {a.type === 'put'
                          ? 'Return to deck'
                          : a.type === 'peektrash'
                            ? 'Trash'
                            : a.type === 'peekdiscard'
                              ? 'Discard'
                              : a.type === 'busk'
                                ? 'Play'
                                : a.type === 'aside'
                                  ? 'Set aside'
                                  : a.type === 'keep'
                                    ? 'Keep'
                                    : 'Put on deck'}{' '}
                        · {card == null ? 'Card' : CARD_NAMES[kindOf(card)]}
                      </button>
                    );
                  })}
              </div>
              {me?.peek.length ? (
                <div class="gg-peek">
                  {me.peek.map((c) =>
                    c.card !== null ? (
                      <Card key={c.pos} kind={kindOf(c.card)} onClick={() => inspect(kindOf(c.card!))} />
                    ) : (
                      <span key={c.pos}>Receiving card…</span>
                    ),
                  )}
                </div>
              ) : null}
            </section>
          )}
          <section class="gg-hand-section" aria-label="Your hand">
            <div class="gg-hand-header">
              <div>
                <h2>{me ? 'Your hand' : 'Watching the performance'}</h2>
                <span>
                  {me
                    ? `${me.hand.length} cards · Only you can see these`
                    : 'Private hands are hidden from spectators.'}
                </span>
              </div>
              <div class="gg-resources">
                <span>
                  <b>{s.actions}</b> Actions
                </span>
                <span>
                  <b>{s.buys}</b> Buys
                </span>
                <span class="gg-money">
                  <b>{s.coins}</b> Coins
                </span>
              </div>
            </div>
            {me && (
              <div class="gg-hand-row">
                <div class="gg-deck-stack">
                  <span>✧</span>
                  <strong>{me.draw.length}</strong>
                  <small>DRAW PILE</small>
                </div>
                <div class="gg-hand">
                  {me.hand.map((c) => {
                    if (c.card === null)
                      return (
                        <div class="gg-hidden" key={c.pos}>
                          ✧<small>Receiving…</small>
                        </div>
                      );
                    const a = legal.find((a) => 'pos' in a && a.pos === c.pos);
                    return (
                      <Card
                        key={c.pos}
                        kind={kindOf(c.card)}
                        available={enabled && !!a}
                        onClick={() => inspect(kindOf(c.card as number), a)}
                      />
                    );
                  })}
                  {me.hand.length === 0 && <p class="gg-muted">Your hand is empty.</p>}
                </div>
                <div class="gg-discard-stack">
                  <strong>{me.discard.length}</strong>
                  <small>DISCARD</small>
                  {me.discard.at(-1)?.card != null && (
                    <span>{CARD_NAMES[kindOf(me.discard.at(-1)!.card as number)]}</span>
                  )}
                </div>
              </div>
            )}
            <div class="gg-controls">
              <span>
                {props.ended
                  ? 'Game complete'
                  : !props.canAct
                    ? props.lockedReason || 'Waiting for the table'
                    : enabled
                      ? 'Click a card to inspect it and make your move.'
                      : 'Sending your move…'}
              </span>
              <div>
                {simple('done', decision === 'rehearsal' ? 'Finish discarding' : 'Done / skip')}
                {simple('accept', 'Accept attack')}
                {simple('novictory', 'Reveal hand — no victory card')}
                {simple('next', s.phase === 'action' ? 'Play treasures →' : 'Go to buying →', true)}
                {simple('end', 'End turn →', true)}
              </div>
            </div>
            {error && (
              <p role="alert" class="gg-error">
                {error}
              </p>
            )}
          </section>
        </div>
        <aside class="gg-sidebar" aria-label="Players and scores">
          <div class="gg-section-title">
            <h2>The producers</h2>
            <span>{s.seats} PLAYERS</span>
          </div>
          {s.players.map((p, i) => (
            <article class={`gg-player ${i === actor && !props.ended ? 'gg-player-active' : ''}`} key={i}>
              <div class="gg-player-top">
                <div class={`gg-avatar gg-seat-${i}`}>{props.avatars[i] ?? props.names[i]?.[0] ?? '✦'}</div>
                <div>
                  <strong>
                    {props.names[i] ?? `Player ${i + 1}`}
                    {i === props.mySeat && <small> you</small>}
                  </strong>
                  <span>
                    {props.ended ? 'Final score' : i === actor ? 'Taking a turn' : 'Behind the scenes'}
                  </span>
                </div>
                <div class="gg-score">
                  <b>{points[i]}</b>
                  <span>✦ acclaim</span>
                </div>
              </div>
              <div class="gg-player-stats">
                <span>
                  <b>{KINDS.reduce((n, k) => n + p.owned[k], 0)}</b> cards
                </span>
                <span>
                  <b>{p.hand.length}</b> in hand
                </span>
                <span>
                  <b>{p.turns}</b> turns
                </span>
              </div>
              <details class="gg-player-discard">
                <summary>Discard pile · {p.discard.length}</summary>
                {p.discard.map((c) => (
                  <button
                    type="button"
                    key={c.pos}
                    onClick={() => c.card !== null && inspect(kindOf(c.card))}
                  >
                    {c.card === null ? 'Receiving card…' : CARD_NAMES[kindOf(c.card)]}
                  </button>
                ))}
                {!p.discard.length && <p>Empty</p>}
              </details>
              {i === actor && !props.ended && (
                <div class="gg-active-label">● {props.deadline ?? 'IN THE SPOTLIGHT'}</div>
              )}
            </article>
          ))}
          <section class="gg-goal">
            <span>✦</span>
            <h3>Make a lasting impression</h3>
            <p>
              Collect the most acclaim. The game ends after a turn when the Grand Stages run out, or any 3
              supply piles are empty.
            </p>
            <div>
              <b>{s.supply.grandstage.length}</b> Grand Stages remain
            </div>
          </section>
          <section class="gg-log">
            <h3>Table journal</h3>
            <div aria-live="polite">
              {s.log.length ? (
                [...s.log]
                  .reverse()
                  .slice(0, 9)
                  .map((l, i) => (
                    <p key={`${s.log.length}-${i}`}>
                      <b>{props.names[l.seat] ?? `Player ${l.seat + 1}`}</b> {l.text}
                      {l.kind ? ` ${CARD_NAMES[l.kind]}` : ''}.
                    </p>
                  ))
              ) : (
                <p>The house lights dim. A new company takes the stage.</p>
              )}
            </div>
          </section>
          <details class="gg-trash">
            <summary>Cutting-room floor · {s.trash.length} trashed</summary>
            {s.trash.map((c) => (
              <p key={c.pos}>{c.card === null ? 'Hidden card' : CARD_NAMES[kindOf(c.card)]}</p>
            ))}
          </details>
        </aside>
      </div>
      {props.audit === 'pass' && <p class="gg-muted">Deck audit passed.</p>}
      {typeof props.audit === 'object' && (
        <p role="alert" class="gg-error">
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
      <dialog class="gg-dialog" ref={dialog} onClose={() => setSelected(null)} aria-label="Card details">
        <button
          type="button"
          class="gg-dialog-close"
          aria-label="Close card details"
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
        {selected && (
          <>
            <Card kind={selected.kind} />
            <div>
              <p class="gg-eyebrow">
                {CARDS[selected.kind].type} · {CARDS[selected.kind].cost} coins
              </p>
              <h2>{CARD_NAMES[selected.kind]}</h2>
              <p>{CARD_TEXT[selected.kind]}</p>
              {selected.action ? (
                <button
                  type="button"
                  class="gg-primary"
                  disabled={!enabled}
                  onClick={() => selected.action && void send(selected.action)}
                >
                  {selected.action.type === 'buy'
                    ? `Buy for ${CARDS[selected.kind].cost} coins`
                    : selected.action.type === 'block'
                      ? 'Reveal to block'
                      : `${selected.action.type[0]!.toUpperCase()}${selected.action.type.slice(1)} card`}
                </button>
              ) : (
                <p class="gg-muted">
                  {props.ended ? 'The game has finished.' : 'This card has no available move right now.'}
                </p>
              )}
              {error && (
                <p role="alert" class="gg-error">
                  {error}
                </p>
              )}
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
