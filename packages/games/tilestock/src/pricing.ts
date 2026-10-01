import type { TilestockRules } from './rules.ts';
import type { BonusRole } from './types.ts';

/** Share price of a chain at a given size; 0 when the chain is not on the board. */
export function sharePrice(rules: TilestockRules, chain: number, size: number): number {
  if (size < 2) return 0;
  const tier = rules.chains[chain]?.tier;
  if (!tier) return 0;
  let bracket = 0;
  for (let i = 0; i < rules.priceBrackets.length; i++) {
    if (size >= (rules.priceBrackets[i] as number)) bracket = i;
  }
  return rules.tierPrices[tier][bracket] ?? 0;
}

/** Divides `total` among `ways` holders, rounding each portion up to a multiple of $100. */
export function splitUp100(total: number, ways: number): number {
  const unit = 100 * ways;
  const t = total + unit - 1;
  return ((t - (t % unit)) / unit) * 100;
}

export interface BonusPayout {
  readonly seat: number;
  readonly amount: number;
  readonly role: BonusRole;
}

/**
 * Majority/minority shareholder bonuses for one chain at `price`.
 * - Sole holder: gets both bonuses.
 * - Tie for majority: both bonuses are pooled and split evenly among the tied
 *   holders; no minority bonus is paid.
 * - Otherwise the majority holder gets the majority bonus and the minority
 *   bonus goes to the second-largest holding, split evenly if tied.
 * Split portions round up to the next $100. Seats are listed in seat order.
 */
export function bonusPayouts(
  rules: TilestockRules,
  holdings: readonly number[],
  price: number,
): BonusPayout[] {
  const majority = price * rules.majorityMultiplier;
  const minority = price * rules.minorityMultiplier;
  const top = Math.max(0, ...holdings);
  if (top === 0) return [];
  const leaders = holdings.flatMap((h, seat) => (h === top ? [seat] : []));
  if (leaders.length > 1) {
    const each = splitUp100(majority + minority, leaders.length);
    return leaders.map((seat) => ({ seat, amount: each, role: 'majorityTie' as const }));
  }
  const leader = leaders[0] as number;
  const second = Math.max(0, ...holdings.filter((h) => h < top));
  if (second === 0) return [{ seat: leader, amount: majority + minority, role: 'sole' }];
  const runners = holdings.flatMap((h, seat) => (h === second ? [seat] : []));
  const out: BonusPayout[] = [{ seat: leader, amount: majority, role: 'majority' }];
  if (runners.length === 1) out.push({ seat: runners[0] as number, amount: minority, role: 'minority' });
  else {
    const each = splitUp100(minority, runners.length);
    for (const seat of runners) out.push({ seat, amount: each, role: 'minorityTie' });
  }
  return out.sort((a, b) => a.seat - b.seat);
}
