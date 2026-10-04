import {
  bonuses,
  type CardSlot,
  DECK_SIZES,
  type LusterAction,
  type LusterState,
  PATRONS,
  score,
  TIER_DECKS,
  workshop,
} from '@bored-games/luster';
import { LUSTER_THEME } from '@bored-games/luster/theme';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { exactTokens, playerSummary, statusText, tokenText } from './model.ts';
import './luster.css';

const EMPTY = [0, 0, 0, 0, 0, 0];
/** Original geometric stained-glass motif; no external assets. */
export function GlassArt(props: { color: number; variant: number }) {
  const n = props.variant % 4;
  return (
    <svg class={`luster-art luster-color-${props.color}`} viewBox="0 0 120 64" aria-hidden="true">
      <path d="M4 60 L30 4 L90 4 L116 60 Z" fill="currentColor" opacity=".16" />
      <path d={`M60 4 L${30 + n * 5} 32 L60 60 L${90 - n * 5} 32 Z`} fill="currentColor" opacity=".6" />
      <path
        d="M4 60 L60 4 L116 60 M30 4 L60 60 L90 4 M4 32 H116"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
export function LightCounts(props: { counts: readonly number[]; omitZero?: boolean }) {
  return (
    <span class="luster-counts">
      {props.counts.map((n, i) =>
        props.omitZero && n === 0 ? null : (
          <span
            key={i}
            class={`luster-light luster-color-${i}`}
            title={LUSTER_THEME.colors[i]}
            data-color={i}
            data-count={n}
          >
            <span aria-hidden="true">{LUSTER_THEME.symbols[i]}</span>
            <span class="sr-only">{LUSTER_THEME.colors[i]} </span>
            {n}{' '}
          </span>
        ),
      )}
    </span>
  );
}
export function WorkshopCard(props: { slot: CardSlot; children?: ComponentChildren }) {
  const c = props.slot.card === null ? undefined : workshop(props.slot.deck, props.slot.card);
  const name = c ? `${LUSTER_THEME.colors[c.bonus]} workshop` : 'Private reservation';
  return (
    <article
      class="luster-card"
      data-card={props.slot.card ?? 'hidden'}
      data-deck={props.slot.deck}
      data-pos={props.slot.pos}
      data-private={props.slot.private}
    >
      <div class="luster-card-head">
        <strong>{name}</strong>
        <span>
          {c?.points ?? '?'} ✦<span class="sr-only"> radiance</span>
        </span>
      </div>
      <GlassArt color={c?.bonus ?? 5} variant={props.slot.card ?? 0} />
      <p class="luster-card-caption">
        {LUSTER_THEME.tiers[TIER_DECKS.indexOf(props.slot.deck)]}
        {props.slot.private ? ' · blind draw' : ''}
      </p>
      {c ? (
        <>
          <p class="luster-card-caption">
            Cost <LightCounts counts={c.cost} omitZero />
          </p>
          <p class="luster-card-caption">Discount +1 {LUSTER_THEME.colors[c.bonus]}</p>
        </>
      ) : (
        <p class="luster-card-caption">Only its owner can see this workshop.</p>
      )}
      {props.children}
    </article>
  );
}
export function LusterGame(props: GameViewProps) {
  const s = props.view.state as LusterState;
  const legal = props.legal as readonly LusterAction[];
  const [tokens, setTokens] = useState<number[]>(EMPTY);
  const [purchase, setPurchase] = useState<CardSlot | null>(null);
  const [payment, setPayment] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setTokens(EMPTY);
    setPurchase(null);
    setPayment(0);
    setError(null);
  }, [s.seq]);
  const enabled = props.canAct && !props.busy && !sending && !props.ended;
  const send = async (a: LusterAction) => {
    if (!enabled) return;
    setSending(true);
    setError(null);
    try {
      await props.onAct(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The move could not be sent. Try again.');
    } finally {
      setSending(false);
    }
  };
  const takeOrReturn = s.phase === 'return' ? 'return' : 'take';
  const selected = exactTokens(legal, takeOrReturn, tokens);
  const my = props.mySeat === null ? undefined : s.players[props.mySeat];
  const costs =
    purchase === null
      ? []
      : legal.filter(
          (a): a is Extract<LusterAction, { type: 'buy' }> =>
            a.type === 'buy' && a.deck === purchase.deck && a.pos === purchase.pos,
        );
  const actionButtons = (h: CardSlot) => {
    const buys = legal.filter((a) => a.type === 'buy' && a.deck === h.deck && a.pos === h.pos);
    const reserve = legal.find((a) => a.type === 'reserve' && a.deck === h.deck && a.pos === h.pos);
    return (
      <div class="luster-card-actions">
        <button
          type="button"
          disabled={!enabled || buys.length === 0}
          onClick={() => {
            setPurchase(h);
            setPayment(0);
          }}
        >
          Purchase
        </button>
        {reserve && (
          <button type="button" disabled={!enabled} onClick={() => void send(reserve)}>
            Reserve
          </button>
        )}
      </div>
    );
  };
  return (
    <section
      class="luster-game"
      data-testid="luster-game"
      data-seq={s.seq}
      data-turn={s.turn}
      data-starting-seat={s.startingSeat ?? 'pending'}
      data-phase={s.phase}
      data-round={s.round}
      aria-label="Luster game"
    >
      <header class="luster-status">
        <div>
          <p class="luster-eyebrow">
            Round {s.round} · {LUSTER_THEME.title}
          </p>
          <h2 aria-live="polite">{statusText(s, props.mySeat, props.names, props.ended)}</h2>
          {s.startingSeat !== null && (
            <p class="muted">
              First player: {props.names[s.startingSeat] ?? `Player ${s.startingSeat + 1}`} · chosen at random
            </p>
          )}
        </div>
        <a href={rulesHref('luster')}>Rules</a>
      </header>
      {props.deadline && !props.ended && <p class="muted">{props.deadline}</p>}
      {props.notice && <p role="status">{props.notice}</p>}
      {!enabled && !props.ended && (
        <p class="muted">{props.lockedReason || 'Waiting for the other players.'}</p>
      )}
      {error && <p role="alert">{error}</p>}
      <section class="luster-panel" aria-labelledby="luster-supply-title">
        <h3 id="luster-supply-title">Shared light</h3>
        <LightCounts counts={s.supply} />
        <p class="muted">
          Gather up to three different colors, or a pair from a supply of at least four. Reserve to receive a
          Prism.
        </p>
        <fieldset
          disabled={!enabled || (s.phase !== 'turn' && s.phase !== 'return')}
          class="luster-token-form"
        >
          <legend>
            {s.phase === 'return'
              ? `Return ${(my?.tokens.reduce((a, b) => a + b, 0) ?? 10) - 10} tokens`
              : 'Choose light to gather'}
          </legend>
          <div class="luster-token-grid">
            {LUSTER_THEME.colors.map((color, i) =>
              s.phase !== 'return' && i === 5 ? null : (
                <label key={color} class={`luster-color-${i}`}>
                  <span>
                    {LUSTER_THEME.symbols[i]} {color}
                  </span>
                  <input
                    aria-label={`${takeOrReturn === 'return' ? 'Return' : 'Take'} ${color}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={s.phase === 'return' ? (my?.tokens[i] ?? 0) : Math.min(2, s.supply[i] ?? 0)}
                    value={tokens[i]}
                    onInput={(e) => {
                      const n = Number(e.currentTarget.value);
                      setTokens((xs) =>
                        xs.map((x, j) =>
                          j === i ? Math.max(0, Math.min(13, Number.isFinite(n) ? Math.trunc(n) : 0)) : x,
                        ),
                      );
                    }}
                  />
                </label>
              ),
            )}
          </div>
          <button type="button" disabled={!selected} onClick={() => selected && void send(selected)}>
            {s.phase === 'return' ? 'Return selected light' : 'Gather selected light'}
          </button>
        </fieldset>
        {legal.find((a) => a.type === 'pass') && (
          <button
            type="button"
            disabled={!enabled}
            onClick={() => {
              const a = legal.find((a) => a.type === 'pass');
              if (a) void send(a);
            }}
          >
            Pass — no main action available
          </button>
        )}
      </section>
      {purchase && (
        <section class="luster-panel luster-payment" aria-labelledby="luster-payment-title">
          <h3 id="luster-payment-title">Purchase this workshop</h3>
          <WorkshopCard slot={purchase} />
          <label>
            Choose payment
            <select
              aria-label="Choose payment"
              value={payment}
              disabled={!enabled}
              onChange={(e) => setPayment(Number(e.currentTarget.value))}
            >
              {costs.map((a, i) => (
                <option key={i} value={i}>
                  {a.pay.every((n) => n === 0) ? 'Free — use workshop discounts' : tokenText(a.pay)}
                </option>
              ))}
            </select>
          </label>
          <div class="luster-card-actions">
            <button
              type="button"
              disabled={!enabled || !costs[payment]}
              onClick={() => {
                const a = costs[payment];
                if (a) void send(a);
              }}
            >
              Confirm purchase
            </button>
            <button type="button" onClick={() => setPurchase(null)}>
              Cancel purchase
            </button>
          </div>
        </section>
      )}
      <section class="luster-panel" aria-labelledby="luster-patrons-title">
        <h3 id="luster-patrons-title">Patron commissions</h3>
        <p class="muted">Earn 3 radiance by meeting these workshop discounts. One patron per turn.</p>
        <div class="luster-patrons">
          {s.patrons.map((p) => {
            const a = legal.find((a) => a.type === 'patron' && a.card === p.card);
            return (
              <article key={p.pos} class="luster-patron" data-card={p.card} data-pos={p.pos}>
                <strong>{p.card === null ? 'Revealing commission…' : LUSTER_THEME.patrons[p.card]}</strong>
                <span>3 ✦</span>
                <LightCounts counts={p.card === null ? EMPTY : (PATRONS[p.card] ?? EMPTY)} omitZero />
                {a && (
                  <button type="button" disabled={!enabled} onClick={() => void send(a)}>
                    Choose {LUSTER_THEME.patrons[p.card as number]}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {[...TIER_DECKS].reverse().map((deck) => {
        const i = TIER_DECKS.indexOf(deck);
        const blind = legal.find(
          (a) => a.type === 'reserve' && a.deck === deck && a.pos === s.decks[deck].next,
        );
        return (
          <section class="luster-panel" key={deck} aria-label={`${LUSTER_THEME.tiers[i]} market`}>
            <div class="luster-market-head">
              <h3>
                {LUSTER_THEME.tiers[i]} <small>Tier {i + 1}</small>
              </h3>
              <span>{DECK_SIZES[deck] - s.decks[deck].next} unseen</span>
              <button type="button" disabled={!enabled || !blind} onClick={() => blind && void send(blind)}>
                Reserve blind tier {i + 1}
              </button>
            </div>
            <div class="luster-market">
              {s.market[i]?.map((h, j) =>
                h === null ? (
                  <div key={`empty-${j}`} class="luster-card luster-empty">
                    Tier exhausted
                  </div>
                ) : (
                  <WorkshopCard key={h.pos} slot={h}>
                    {h.card === null ? <p role="status">Revealing workshop…</p> : actionButtons(h)}
                  </WorkshopCard>
                ),
              )}
            </div>
          </section>
        );
      })}
      <section aria-labelledby="luster-players-title">
        <h3 id="luster-players-title">Glassmakers</h3>
        <div class="luster-players">
          {s.players.map((p, seat) => (
            <section
              key={seat}
              class={`luster-panel ${s.turn === seat && !props.ended ? 'luster-active' : ''}`}
              data-seat={seat}
              data-tokens={p.tokens.join(',')}
              aria-label={props.names[seat] ?? `Player ${seat + 1}`}
            >
              <h4>
                {props.avatars[seat]} {props.names[seat] ?? `Player ${seat + 1}`}
                {seat === props.mySeat ? ' (you)' : ''}
                {s.result ? ` · Place ${s.result.places[seat]}` : ''}
              </h4>
              <p>{playerSummary(s, seat)}</p>
              <p>
                Light <LightCounts counts={p.tokens} />
              </p>
              <p>
                Discounts <LightCounts counts={bonuses(p)} />
              </p>
              {p.patrons.length > 0 && (
                <p>Patrons: {p.patrons.map((id) => LUSTER_THEME.patrons[id]).join(', ')}</p>
              )}
              <h5>Reservations ({p.reserved.length}/3)</h5>
              <div class="luster-reservations">
                {p.reserved.map((h) => (
                  <WorkshopCard key={`${h.deck}:${h.pos}`} slot={h}>
                    {seat === props.mySeat && actionButtons(h)}
                  </WorkshopCard>
                ))}
              </div>
              <details>
                <summary>
                  Collection — {p.bought.length} workshops, {score(p)} radiance
                </summary>
                <div class="luster-reservations">
                  {p.bought.map((h) => (
                    <WorkshopCard key={`${h.deck}:${h.pos}`} slot={h} />
                  ))}
                </div>
              </details>
            </section>
          ))}
        </div>
      </section>
      {props.audit === 'pass' && <p role="status">Deck audit passed.</p>}
      {typeof props.audit === 'object' && <p role="alert">Deck audit failed: {props.audit.reason}</p>}
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
