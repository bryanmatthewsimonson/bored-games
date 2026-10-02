/*
 * The stock price and bonus card: one row per size bracket, one column group per price tier. In a game it is
 * given the current chain sizes and marks each chain on the board in the row it is priced at; the rules page shows
 * it without marks. `PriceCard` uses no hooks, so tests can expand it without a DOM.
 */
import type { ChainReactionRules } from '@bored-games/chain-reaction';
import type { ChainReactionTheme } from '@bored-games/chain-reaction/theme';
import { Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Swatch } from './board.tsx';
import { type ChainView, formatMoney, priceCard, priceRowOf } from './model.ts';
import './game.css';

export interface PriceCardProps {
  rules: ChainReactionRules;
  /** The names and looks in effect (D046). */
  theme: ChainReactionTheme;
  /** Current size of each chain, in rules order; marks each chain on the board in its row. */
  sizes?: readonly number[] | undefined;
}

export function PriceCard(props: PriceCardProps) {
  const { rules, theme, sizes } = props;
  const card = priceCard(theme, rules);
  // Row index → tier index → the chains of that tier priced at that row, with their sizes.
  const marks = new Map<number, Map<number, { chain: ChainView; size: number }[]>>();
  card.tiers.forEach((t, ti) => {
    for (const chain of t.chains) {
      const size = sizes?.[chain.index] ?? 0;
      const row = priceRowOf(rules, size);
      if (row === null) continue;
      const byTier = marks.get(row) ?? new Map<number, { chain: ChainView; size: number }[]>();
      byTier.set(ti, [...(byTier.get(ti) ?? []), { chain, size }]);
      marks.set(row, byTier);
    }
  });
  const marked = sizes !== undefined;
  return (
    <div class="cr-pc">
      {marked && (
        <p class="cr-pc-legend">
          Each chain on the board is shown by its letter in the row of its current size, with its tier's
          numbers outlined.
        </p>
      )}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the table scrolls sideways on a phone; keyboard too. */}
      <section class="cr-table-scroll cr-pc-scroll" aria-label="Price card table" tabIndex={0}>
        <table class="cr-pc-table">
          <caption class="sr-only">Share price and bonuses by chain size and tier</caption>
          <colgroup>
            <col />
          </colgroup>
          {card.tiers.map((t) => (
            <colgroup key={t.tier} span={3} />
          ))}
          <thead>
            <tr>
              <th scope="col" rowSpan={2} class="cr-pc-size">
                Size <span class="cr-pc-unit">(tiles)</span>
              </th>
              {card.tiers.map((t) => (
                <th key={t.tier} scope="colgroup" colSpan={3} class="cr-pc-tier">
                  <span class="cr-pc-tier-name">{t.name}</span>
                  <span class="cr-pc-tier-chains">
                    {t.chains.map((c) => (
                      <span key={c.id} class="cr-chain-name">
                        <Swatch chain={c} />
                        {c.name}
                      </span>
                    ))}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              {card.tiers.map((t) => (
                <Fragment key={t.tier}>
                  <th scope="col" class="cr-pc-start">
                    Price
                  </th>
                  <th scope="col">Majority</th>
                  <th scope="col">Minority</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, ri) => {
              const here = marks.get(ri);
              return (
                <tr key={row.label} class={here ? 'cr-pc-current' : undefined}>
                  <th scope="row" class="cr-pc-size">
                    {row.label}
                  </th>
                  {row.cells.map((cell, ti) => {
                    const chains = here?.get(ti) ?? [];
                    const on = chains.length > 0 ? ' cr-pc-here' : '';
                    const tier = card.tiers[ti]?.tier ?? ti;
                    return (
                      <Fragment key={tier}>
                        <td class={`cr-pc-start cr-pc-price${on}`}>
                          {chains.map(({ chain, size }) => (
                            <span key={chain.id} class="cr-pc-chip">
                              <Swatch chain={chain} />
                              <span class="sr-only">
                                {chain.name}, {size} tiles:{' '}
                              </span>
                            </span>
                          ))}
                          {formatMoney(cell.price)}
                        </td>
                        <td class={on.trim() || undefined}>{formatMoney(cell.majority)}</td>
                        <td class={on === '' ? undefined : 'cr-pc-here cr-pc-end'}>
                          {formatMoney(cell.minority)}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <ul class="cr-pc-notes">
        <li>
          The majority bonus is {rules.majorityMultiplier}× the share price and the minority bonus{' '}
          {rules.minorityMultiplier}×. A sole holder gets both.
        </li>
        <li>
          On a majority tie, both bonuses are pooled and split evenly among the tied holders, and no minority
          bonus is paid. On a minority tie, the minority bonus is split evenly. Every split portion rounds up
          to the next {formatMoney(100)}.
        </li>
        <li>
          A chain of {rules.safeSize}+ tiles is safe: it can never be taken over. On your turn you may declare
          the end once any chain has {rules.endSize}+ tiles, or every chain on the board is safe.
        </li>
        <li>
          In a merger, shares of a defunct chain sell at its pre-merger price, or trade 2 for 1 for shares of
          the survivor while the bank has them.
        </li>
      </ul>
    </div>
  );
}

/** The price card in a modal dialog, over the game. Escape and a press on the backdrop close it. */
export function PriceCardDialog(props: {
  open: boolean;
  onClose: () => void;
  rules: ChainReactionRules;
  theme: ChainReactionTheme;
  sizes: readonly number[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, onClose } = props;

  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      class="dialog dialog-wide"
      aria-labelledby="cr-price-card-h"
      onClose={onClose}
      onPointerDown={(e) => {
        // A press on the backdrop lands on the <dialog> element itself. Escape closes it from the keyboard.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div class="dialog-body">
          <div class="dialog-head">
            <h2 id="cr-price-card-h">Price card</h2>
            <button type="button" class="btn" onClick={onClose}>
              Close
            </button>
          </div>
          <PriceCard rules={props.rules} theme={props.theme} sizes={props.sizes} />
        </div>
      )}
    </dialog>
  );
}
