import {
  bonuses,
  type CardSlot,
  DECK_SIZES,
  type LusterAction,
  type LusterState,
  PATRONS,
  payments,
  score,
  TIER_DECKS,
  workshop,
} from '@bored-games/luster';
import { LUSTER_THEME } from '@bored-games/luster/theme';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { GemIcon, GemLandscape, NobleArt } from './art.tsx';
import { exactTokens, nextTokens, playerSummary, statusText } from './model.ts';
import './luster.css';

const EMPTY = [0, 0, 0, 0, 0, 0];
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
            <GemIcon color={i} />
            <span class="sr-only">{LUSTER_THEME.colors[i]} </span>
            <b>{n}</b>{' '}
          </span>
        ),
      )}
    </span>
  );
}
export function WorkshopCard(props: {
  slot: CardSlot;
  onSelect?: (() => void) | undefined;
  selected?: boolean;
  affordable?: boolean;
}) {
  const c = props.slot.card === null ? undefined : workshop(props.slot.deck, props.slot.card);
  const tier = TIER_DECKS.indexOf(props.slot.deck);
  const content = c ? (
    <>
      <div class="luster-card-head">
        <span class="luster-card-points">
          {c.points}
          <span aria-hidden="true">✦</span>
          <span class="sr-only"> prestige</span>
        </span>
        <span class={`luster-card-bonus luster-color-${c.bonus}`}>
          <GemIcon color={c.bonus} />
        </span>
      </div>
      <GemLandscape color={c.bonus} variant={props.slot.card ?? 0} tier={tier} />
      <span class="luster-card-caption">{LUSTER_THEME.colors[c.bonus]} development</span>
      {props.affordable && <span class="luster-affordable-label">Affordable</span>}
      <span class="luster-card-cost">
        <span class="sr-only">Cost </span>
        <LightCounts counts={c.cost} omitZero />
      </span>
      <span class="sr-only">Discount +1 {LUSTER_THEME.colors[c.bonus]}</span>
      {props.slot.private && <span class="luster-private-label">Blind reservation</span>}
    </>
  ) : (
    <div class="luster-card-back">
      <span aria-hidden="true">✦</span>
      <strong>{props.slot.private ? 'Private reservation' : 'Revealing card…'}</strong>
      <small>
        {props.slot.private
          ? 'Only its owner can see this card.'
          : 'Waiting for the public card to be revealed.'}
      </small>
    </div>
  );
  return (
    <article
      class={`luster-card ${props.selected ? 'luster-card-selected' : ''} ${props.affordable ? 'luster-card-affordable' : ''}`}
      data-card={props.slot.card ?? 'hidden'}
      data-deck={props.slot.deck}
      data-pos={props.slot.pos}
      data-private={props.slot.private}
    >
      {props.onSelect ? (
        <button
          type="button"
          class="luster-card-face"
          onClick={props.onSelect}
          aria-label={`Select ${c ? LUSTER_THEME.colors[c.bonus] : 'unseen'} card, tier ${tier + 1}, position ${props.slot.pos + 1}`}
        >
          {content}
        </button>
      ) : (
        <div class="luster-card-face">{content}</div>
      )}
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
  const dialog = useRef<HTMLDialogElement>(null);
  const closeCard = () => {
    dialog.current?.close();
    setPurchase(null);
  };
  useEffect(() => {
    setTokens(EMPTY);
    dialog.current?.close();
    setPurchase(null);
    setPayment(0);
    setError(null);
  }, [s.seq]);
  useEffect(() => {
    if (purchase !== null && !dialog.current?.open) dialog.current?.showModal();
  }, [purchase]);
  const enabled = props.canAct && !props.busy && !sending && !props.ended;
  const send = async (a: LusterAction) => {
    if (!enabled) return;
    setSending(true);
    setError(null);
    try {
      await props.onAct(a);
      closeCard();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The move could not be sent. Try again.');
    } finally {
      setSending(false);
    }
  };
  const returning = s.phase === 'return';
  const takeOrReturn = returning ? 'return' : 'take';
  const selected = exactTokens(legal, takeOrReturn, tokens);
  const my = props.mySeat === null ? undefined : s.players[props.mySeat];
  const affordable = (slot: CardSlot) => {
    return (
      !props.ended && my !== undefined && slot.card !== null && payments(my, slot.deck, slot.card).length > 0
    );
  };
  const selectionCount = tokens.reduce((a, b) => a + b, 0);
  const excess = (my?.tokens.reduce((a, b) => a + b, 0) ?? 10) - 10;
  const costs =
    purchase === null
      ? []
      : legal.filter(
          (a): a is Extract<LusterAction, { type: 'buy' }> =>
            a.type === 'buy' && a.deck === purchase.deck && a.pos === purchase.pos,
        );
  const reserve =
    purchase === null
      ? undefined
      : legal.find((a) => a.type === 'reserve' && a.deck === purchase.deck && a.pos === purchase.pos);
  const card =
    purchase?.card === null || purchase === null ? undefined : workshop(purchase.deck, purchase.card);
  const discounts = my ? bonuses(my) : EMPTY;
  const due = card?.cost.map((n, i) => Math.max(0, n - (discounts[i] ?? 0))) ?? [];
  const chosenPayment = costs[payment];
  const swapPayment = (color: number, change: number) =>
    costs.findIndex(
      (a) =>
        chosenPayment !== undefined &&
        a.pay.every(
          (n, i) => n === (chosenPayment.pay[i] ?? 0) + (i === color ? change : i === 5 ? -change : 0),
        ),
    );
  const selectCard = (slot: CardSlot) => {
    setTokens(EMPTY);
    setPurchase(slot);
    setPayment(0);
    setError(null);
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
            {LUSTER_THEME.title}{' '}
            <span>
              Round {s.round}
              {s.finalRound ? ' · Final round' : ''}
            </span>
          </p>
          <h2 aria-live="polite">{statusText(s, props.mySeat, props.names, props.ended)}</h2>
          {s.startingSeat !== null && (
            <p class="luster-first-player">
              First player: {props.names[s.startingSeat] ?? `Player ${s.startingSeat + 1}`} · chosen at random
            </p>
          )}
        </div>
        <a href={rulesHref('luster')}>Rules ↗</a>
      </header>
      {props.deadline && !props.ended && <p class="luster-note">{props.deadline}</p>}
      {props.notice && (
        <p class="luster-note" role="status">
          {props.notice}
        </p>
      )}
      {!enabled && !props.ended && (
        <p class="luster-note">{props.lockedReason || 'Waiting for the other players.'}</p>
      )}
      {error && !purchase && (
        <p class="luster-error" role="alert">
          {error}
        </p>
      )}
      <section class="luster-bank" aria-labelledby="luster-supply-title" data-supply={s.supply.join(',')}>
        <div class="luster-section-heading">
          <h3 id="luster-supply-title">{returning ? 'Return from your hand' : 'Gem bank'}</h3>
          <span>{returning ? `Return ${excess} to keep 10` : 'Take 3 different · or 2 of one'}</span>
        </div>
        <fieldset disabled={!enabled || (s.phase !== 'turn' && !returning)} class="luster-token-form">
          <legend class="sr-only">{returning ? 'Choose gems to return' : 'Choose gems to take'}</legend>
          <div class="luster-token-grid">
            {LUSTER_THEME.colors.map((color, i) => {
              const next = nextTokens(legal, takeOrReturn, tokens, i);
              const count = returning ? (my?.tokens[i] ?? 0) : (s.supply[i] ?? 0);
              const changes = next.some((n, j) => n !== tokens[j]);
              return (
                <button
                  key={color}
                  type="button"
                  class={`luster-token-stack luster-color-${i} ${tokens[i] ? 'luster-token-selected' : ''}`}
                  disabled={!changes || (!returning && i === 5)}
                  aria-label={`${returning ? 'Return' : 'Take'} ${color}`}
                  aria-pressed={Boolean(tokens[i])}
                  aria-describedby={`luster-gem-description-${i}`}
                  title={
                    i === 5 && !returning
                      ? 'Receive gold by reserving a card'
                      : `${color}: ${count} available. Click to select; click again for a pair or to clear.`
                  }
                  onClick={() => {
                    setPurchase(null);
                    setTokens(next);
                  }}
                >
                  <span class="luster-token-disc">
                    <GemIcon color={i} />
                    <b class="luster-token-count">{count}</b>
                    {Boolean(tokens[i]) && <span class="luster-token-picked">{tokens[i]} selected</span>}
                  </span>
                  <span class="luster-token-name">{color}</span>
                  <span id={`luster-gem-description-${i}`} class="sr-only">
                    {count} available, {tokens[i]} selected
                  </span>
                  <small>
                    {i === 5 && !returning
                      ? 'Reserve to receive'
                      : returning
                        ? `Bank: ${s.supply[i]}`
                        : 'Click to select'}
                  </small>
                </button>
              );
            })}
          </div>
        </fieldset>
        <p class="luster-bank-rule">
          {returning
            ? 'Gold counts toward your ten-token limit.'
            : `${s.seats}-player setup: ${s.seats === 2 ? 4 : s.seats === 3 ? 5 : 7} of each gem · 5 gold. A pair needs at least 4 in the bank before taking.`}
        </p>
        {my && (
          <section class="luster-bank-hand" aria-label="Your resources">
            <div>
              <span>Your gems</span>
              <LightCounts counts={my.tokens} />
            </div>
            <div>
              <span>Your discounts</span>
              <LightCounts counts={bonuses(my)} />
            </div>
          </section>
        )}
      </section>
      <div class="luster-board">
        <div class="luster-tiers">
          {[...TIER_DECKS].reverse().map((deck) => {
            const i = TIER_DECKS.indexOf(deck);
            const remaining = DECK_SIZES[deck] - s.decks[deck].next;
            const blind = legal.find(
              (a) => a.type === 'reserve' && a.deck === deck && a.pos === s.decks[deck].next,
            );
            return (
              <section
                class={`luster-tier luster-tier-${i}`}
                key={deck}
                aria-label={`${LUSTER_THEME.tiers[i]} market`}
              >
                <div class="luster-market">
                  <button
                    type="button"
                    class="luster-deck"
                    disabled={!enabled || !blind}
                    aria-label={`Reserve blind tier ${i + 1}`}
                    onClick={() => selectCard({ deck, pos: s.decks[deck].next, card: null, private: true })}
                  >
                    <span class="luster-deck-level">{'ⅠⅡⅢ'[i]}</span>
                    <span class="luster-deck-mark" aria-hidden="true">
                      ✦
                    </span>
                    <strong>{remaining}</strong>
                    <small>cards</small>
                    <span class="luster-deck-caption">{LUSTER_THEME.tiers[i]}</span>
                  </button>
                  {s.market[i]?.map((slot, j) =>
                    slot === null ? (
                      <div key={`empty-${j}`} class="luster-card luster-empty">
                        Exhausted
                      </div>
                    ) : (
                      <WorkshopCard
                        key={slot.pos}
                        slot={slot}
                        onSelect={slot.card === null ? undefined : () => selectCard(slot)}
                        affordable={affordable(slot)}
                        selected={purchase?.deck === slot.deck && purchase.pos === slot.pos}
                      />
                    ),
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <section class="luster-nobles" aria-labelledby="luster-patrons-title">
          <div class="luster-section-heading">
            <h3 id="luster-patrons-title">Nobles</h3>
            <span>3 prestige each</span>
          </div>
          <div class="luster-patrons">
            {s.patrons.map((p) => {
              const a = legal.find((a) => a.type === 'patron' && a.card === p.card);
              return (
                <article
                  key={p.pos}
                  class={`luster-patron ${a ? 'luster-patron-eligible' : ''}`}
                  data-card={p.card ?? 'hidden'}
                  data-pos={p.pos}
                >
                  <NobleArt variant={p.card ?? 0} />
                  <div>
                    <strong>{p.card === null ? 'Revealing…' : LUSTER_THEME.patrons[p.card]}</strong>
                    <span class="luster-noble-score">3 ✦</span>
                    <LightCounts counts={p.card === null ? EMPTY : (PATRONS[p.card] ?? EMPTY)} omitZero />
                  </div>
                  {a && (
                    <button
                      type="button"
                      class="luster-noble-select"
                      disabled={!enabled}
                      aria-label={`Choose ${LUSTER_THEME.patrons[p.card as number]}`}
                      onClick={() => void send(a)}
                    >
                      <span class="sr-only">Choose noble</span>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
      <section
        class={`luster-selection ${enabled ? 'luster-selection-ready' : ''} ${selectionCount || returning ? 'luster-selection-active' : ''}`}
        aria-label="Gem selection"
      >
        <div class="luster-selection-copy">
          <strong>
            {props.ended
              ? 'Game complete'
              : !enabled
                ? 'Waiting for the next move'
                : returning
                  ? `Return ${excess} gems`
                  : selectionCount
                    ? `${selectionCount} gem${selectionCount === 1 ? '' : 's'} selected`
                    : 'Make your move'}
          </strong>
          <span>
            {props.ended
              ? 'Click cards to inspect the final board.'
              : !enabled
                ? 'You can inspect cards while you wait.'
                : returning
                  ? 'Click gems from your hand above.'
                  : selectionCount
                    ? 'Click a selected gem here to remove it.'
                    : 'Click gems to take them, or a card to buy or reserve.'}
          </span>
        </div>
        <div class="luster-selection-gems" aria-live="polite">
          {tokens.flatMap((n, color) =>
            Array.from({ length: n }, (_, i) => (
              <button
                key={`${color}-${i}`}
                type="button"
                class={`luster-selected-gem luster-color-${color}`}
                aria-label={`Remove selected ${LUSTER_THEME.colors[color]}`}
                disabled={!enabled}
                onClick={() => setTokens((xs) => xs.map((x, j) => (j === color ? x - 1 : x)))}
              >
                <GemIcon color={color} />
                <span aria-hidden="true">×</span>
              </button>
            )),
          )}
        </div>
        <div class="luster-selection-actions">
          <button
            type="button"
            class="luster-clear"
            disabled={!enabled || !selectionCount}
            onClick={() => setTokens(EMPTY)}
          >
            Clear
          </button>
          <button
            type="button"
            class="luster-primary"
            disabled={!enabled || !selected}
            onClick={() => selected && void send(selected)}
          >
            {returning ? 'Return gems' : 'Take gems'}
          </button>
        </div>
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
      <section class="luster-player-section" aria-labelledby="luster-players-title">
        <div class="luster-section-heading">
          <h3 id="luster-players-title">Merchants</h3>
          <span>15 prestige starts the final round</span>
        </div>
        <div class="luster-players">
          {s.players.map((p, seat) => (
            <section
              key={seat}
              class={`luster-player ${s.turn === seat && !props.ended ? 'luster-active' : ''} ${seat === props.mySeat ? 'luster-you' : ''}`}
              data-seat={seat}
              data-tokens={p.tokens.join(',')}
              data-patrons={p.patrons.join(',')}
              aria-label={props.names[seat] ?? `Player ${seat + 1}`}
            >
              <header>
                <h4>
                  {props.avatars[seat]}{' '}
                  <span>
                    {props.names[seat] ?? `Player ${seat + 1}`}
                    {seat === props.mySeat ? ' (you)' : ''}
                  </span>
                </h4>
                <span class="luster-player-score" title="Prestige">
                  {score(p)}
                  <small> / 15</small>
                </span>
              </header>
              <p class="sr-only">{playerSummary(s, seat)}</p>
              {s.result && <p class="luster-place">Place {s.result.places[seat]}</p>}
              <div class="luster-player-counts">
                <span>Gems</span>
                <LightCounts counts={p.tokens} />
              </div>
              <div class="luster-player-counts luster-discounts">
                <span>Discounts</span>
                <LightCounts counts={bonuses(p)} />
              </div>
              {p.patrons.length > 0 && (
                <p class="luster-earned-nobles">
                  Nobles: {p.patrons.map((id) => LUSTER_THEME.patrons[id]).join(', ')}
                </p>
              )}
              <h5>
                Reserved <span>{p.reserved.length}/3</span>
              </h5>
              <div class="luster-reservations">
                {p.reserved.map((slot) => (
                  <WorkshopCard
                    key={`${slot.deck}:${slot.pos}`}
                    slot={slot}
                    onSelect={
                      seat === props.mySeat && slot.card !== null ? () => selectCard(slot) : undefined
                    }
                    affordable={seat === props.mySeat && affordable(slot)}
                  />
                ))}
              </div>
              <details>
                <summary>
                  Developments <b>{p.bought.length}</b>
                </summary>
                <div class="luster-reservations">
                  {p.bought.map((slot) => (
                    <WorkshopCard key={`${slot.deck}:${slot.pos}`} slot={slot} />
                  ))}
                </div>
              </details>
            </section>
          ))}
        </div>
      </section>
      {props.audit === 'pass' && (
        <p class="luster-note" role="status">
          Deck audit passed.
        </p>
      )}
      {typeof props.audit === 'object' && (
        <p class="luster-error" role="alert">
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
      {purchase && (
        <dialog
          ref={dialog}
          class="luster-dialog"
          aria-labelledby="luster-payment-title"
          onCancel={closeCard}
          onClose={() => setPurchase(null)}
        >
          <div class="luster-dialog-head">
            <h3 id="luster-payment-title">
              {card ? `${LUSTER_THEME.colors[card.bonus]} development` : 'Reserve an unseen card'}
            </h3>
            <button type="button" aria-label="Close card" onClick={closeCard}>
              ×
            </button>
          </div>
          <div class="luster-dialog-body">
            <WorkshopCard slot={purchase} />
            <div class="luster-payment">
              <p>
                {card
                  ? 'Price after your discounts'
                  : `Draw privately from tier ${TIER_DECKS.indexOf(purchase.deck) + 1}.`}
              </p>
              {card && <LightCounts counts={due} omitZero />}
              {chosenPayment && (
                <>
                  <h4>
                    {due.every((n) => n === 0)
                      ? 'Free with your discounts'
                      : costs.length > 1
                        ? 'Choose your payment'
                        : 'Your payment'}
                  </h4>
                  {costs.length > 1 && (
                    <>
                      <p class="luster-note">Click a gem to swap it for gold. Click gold to swap it back.</p>
                      <div class="luster-payment-rows">
                        {due.map((n, color) => {
                          if (!n) return null;
                          const useGold = swapPayment(color, -1);
                          const useColor = swapPayment(color, 1);
                          return (
                            <div key={color} class="luster-payment-row">
                              <span>{LUSTER_THEME.colors[color]}</span>
                              <button
                                type="button"
                                disabled={!enabled || useGold < 0}
                                aria-label={`Use gold instead of ${LUSTER_THEME.colors[color]}`}
                                onClick={() => setPayment(useGold)}
                              >
                                <GemIcon color={color} />
                                <b>{chosenPayment.pay[color]}</b>
                              </button>
                              <span>↔</span>
                              <button
                                type="button"
                                disabled={!enabled || useColor < 0}
                                aria-label={`Use ${LUSTER_THEME.colors[color]} instead of gold`}
                                onClick={() => setPayment(useColor)}
                              >
                                <GemIcon color={5} />
                                <b>{n - (chosenPayment.pay[color] ?? 0)}</b>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <p class="luster-spend" data-payment={chosenPayment.pay.join(',')}>
                    {chosenPayment.pay.some((n) => n > 0) ? (
                      <>
                        Spend <LightCounts counts={chosenPayment.pay} omitZero />
                      </>
                    ) : (
                      'No gems needed'
                    )}
                  </p>
                </>
              )}
              {card && !chosenPayment && (
                <p class="luster-note">
                  {enabled
                    ? 'You cannot afford this card yet. Reserve it for a future turn.'
                    : 'This card can be bought on your turn when you can pay its price.'}
                </p>
              )}
              {error && (
                <p class="luster-error" role="alert">
                  {error}
                </p>
              )}
              {card && (
                <button
                  type="button"
                  class="luster-primary"
                  disabled={!enabled || !chosenPayment}
                  onClick={() => chosenPayment && void send(chosenPayment)}
                >
                  Buy card
                </button>
              )}
              {reserve && (
                <button
                  type="button"
                  class="luster-reserve-button"
                  disabled={!enabled}
                  onClick={() => void send(reserve)}
                >
                  Reserve card {s.supply[5] ? '· +1 gold' : '· no gold left'}
                </button>
              )}
              <button type="button" class="luster-clear" onClick={closeCard}>
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}
