import { type LusterAction, type LusterState, score } from '@bored-games/luster';
import { LUSTER_THEME } from '@bored-games/luster/theme';
export function tokenText(xs: readonly number[]): string {
  const text = xs.flatMap((n, i) => (n ? [`${n} ${LUSTER_THEME.colors[i]}`] : [])).join(', ');
  return text || 'No tokens';
}
export function actionKey(a: unknown): string {
  return JSON.stringify(a);
}
export function exactTokens(
  legal: readonly LusterAction[],
  type: 'take' | 'return',
  tokens: readonly number[],
): LusterAction | undefined {
  return legal.find((a) => a.type === type && a.tokens.every((n, i) => n === tokens[i]));
}
/** Only offer selections that can still complete a legal move; clicking again cycles a color. */
export function nextTokens(
  legal: readonly LusterAction[],
  type: 'take' | 'return',
  current: readonly number[],
  color: number,
): number[] {
  const candidate = current.map((n, i) => (i === color ? n + 1 : n));
  const possible = legal.some((a) => a.type === type && candidate.every((n, i) => n <= (a.tokens[i] ?? 0)));
  if (possible) return candidate;
  return current.map((n, i) => (i === color ? 0 : n));
}
export function statusText(
  s: LusterState,
  mySeat: number | null,
  names: readonly string[],
  ended: boolean,
): string {
  if (ended) {
    const winners =
      s.result?.places.flatMap((p, i) => (p === 1 ? [names[i] ?? `Player ${i + 1}`] : [])) ?? [];
    return s.result
      ? `${winners.join(' and ')} ${winners.length === 1 ? 'wins' : 'share first place'}.`
      : 'The game has ended.';
  }
  if (s.startingSeat === null) return 'Choosing a starting player…';
  const who = s.turn === mySeat ? 'Your turn' : `${names[s.turn] ?? `Player ${s.turn + 1}`}'s turn`;
  const decision =
    s.phase === 'return'
      ? 'return gems to keep ten tokens'
      : s.phase === 'patron'
        ? 'choose a noble'
        : 'take gems, reserve, or buy';
  return `${who}: ${decision}.${s.finalRound ? ' Final round.' : ''}`;
}
export function playerSummary(s: LusterState, seat: number): string {
  const p = s.players[seat];
  return p ? `${score(p)} prestige · ${p.bought.length} developments · ${p.reserved.length}/3 reserved` : '';
}
