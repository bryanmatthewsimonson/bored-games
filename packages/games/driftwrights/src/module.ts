import type { ApplyResult, GameModule, Learn, Outcome, Pending, SetupInput } from '@bored-games/game-kit';
import { choices } from './choices.ts';
import {
  apply as coreApply,
  invariants as coreInvariants,
  setup as coreSetup,
  handCount,
  prestige,
  total,
  transferSupply,
  UNKNOWN,
  unknownGoods,
  ZERO,
} from './engine.ts';
import type { Action, State } from './types.ts';

export interface DriftRules {
  readonly layout: 'classic';
  readonly windfall: 'available' | 'two';
}
export interface NetworkState extends State {
  readonly net: {
    readonly mode: 'full' | 'view';
    readonly viewer: number | null;
    readonly rolls: readonly { readonly id: number; readonly last: number }[];
    readonly contributors: readonly number[];
    readonly roll: number | null;
    readonly selection: number | null;
    readonly card: number | null;
    readonly landmarks: readonly number[];
  };
}
export type NetworkEvent = { readonly type: 'action'; readonly action: unknown };
const fail = (message: string): ApplyResult<NetworkState, NetworkEvent> => ({
  ok: false,
  error: { code: 'illegal', message },
});
const ok = (state: NetworkState, action: unknown): ApplyResult<NetworkState, NetworkEvent> => ({
  ok: true,
  state,
  events: [{ type: 'action', action }],
});
const shape = (a: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(a).sort().join(',') === [...keys].sort().join(',');
const integer = (n: unknown, max: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && !Object.is(n, -0) && n >= 0 && n < max;
const rules: DriftRules = { layout: 'classic', windfall: 'available' };

function setup(input: SetupInput<DriftRules>) {
  const order = input.mode === 'full' ? input.deckOrders.ventures : Array.from({ length: 25 }, (_, i) => i);
  if (!Array.isArray(order))
    return { ok: false as const, error: { code: 'deck', message: 'Missing ventures.' } };
  const made = coreSetup(input.seats, order);
  if (!made.ok) return made;
  const s: NetworkState = {
    ...made.value,
    networkMode: true,
    windfall: input.rules.windfall,
    publicCounts: Array(input.seats).fill(0),
    ventureOrder: input.mode === 'full' ? order : Array(25).fill(-1),
    players: made.value.players.map((p, i) => ({
      ...p,
      goods: input.mode === 'full' || input.viewer === i ? ZERO : UNKNOWN,
    })),
    net: {
      mode: input.mode,
      viewer: input.mode === 'view' ? input.viewer : null,
      rolls: [],
      contributors: [],
      roll: null,
      selection: null,
      card: null,
      landmarks: [],
    },
  };
  return { ok: true as const, value: s };
}
function selection(s: NetworkState) {
  const c = s.chance;
  if (c?.kind !== 'theft' || s.net.roll === null || s.net.selection === null || s.net.contributors.length)
    return null;
  const goods = s.players[c.victim]?.goods ?? UNKNOWN;
  return {
    id: s.net.roll,
    from: c.victim,
    to: c.thief,
    index: s.net.selection,
    labels: unknownGoods(goods) ? null : goods.flatMap((n, resource) => Array(n).fill(resource) as number[]),
  };
}
function pending(s: NetworkState): Pending {
  if (s.result) return { type: 'over' };
  const contributor = s.net.contributors[0];
  if (contributor !== undefined) return { type: 'player', seat: contributor, decision: 'contribute' };
  if (s.net.roll !== null && s.net.selection === null) return { type: 'beacon', id: s.net.roll };
  const p = selection(s);
  return { type: 'player', seat: p?.from ?? s.actor, decision: p ? 'transfer' : s.stage };
}
function learn(s: NetworkState, l: Learn): ApplyResult<NetworkState, NetworkEvent> {
  if (l.deck === 'supplies') {
    const p = selection(s);
    if (
      !p ||
      p.id !== l.pos ||
      !integer(l.card, 5) ||
      (s.net.mode === 'view' && s.net.viewer !== p.from && s.net.viewer !== p.to)
    )
      return fail('This private resource is not assigned here.');
    if (s.net.card !== null && s.net.card !== l.card) return fail('Conflicting private delivery.');
    return { ok: true, state: { ...s, net: { ...s.net, card: l.card } }, events: [] };
  }
  if (l.deck !== 'ventures' || !integer(l.card, 25)) return fail('Invalid venture delivery.');
  const owner = s.players.findIndex((p) => p.ventures.some((v) => v.pos === l.pos));
  const v = s.players[owner]?.ventures.find((v) => v.pos === l.pos);
  if (!v || (s.net.mode === 'view' && s.net.viewer !== owner) || (v.card >= 0 && v.card !== l.card))
    return fail('Venture is not assigned here.');
  return {
    ok: true,
    state: {
      ...s,
      players: s.players.map((p, i) =>
        i !== owner
          ? p
          : { ...p, ventures: p.ventures.map((v) => (v.pos === l.pos ? { ...v, card: l.card } : v)) },
      ),
    },
    events: [],
  };
}
function apply(s: NetworkState, raw: unknown): ApplyResult<NetworkState, NetworkEvent> {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Malformed action.');
    const a = raw as Record<string, unknown>;
    if (a.type === 'contribute') {
      if (!shape(a, ['type', 'actor', 'id']) || a.actor !== s.net.contributors[0] || a.id !== s.net.roll)
        return fail('No contribution is owed here.');
      return ok({ ...s, net: { ...s.net, contributors: s.net.contributors.slice(1) } }, raw);
    }
    if (a.type === 'rolled') {
      if (
        !shape(a, ['type', 'actor', 'id', 'dice']) ||
        a.actor !== 'beacon' ||
        pending(s).type !== 'beacon' ||
        a.id !== s.net.roll ||
        !Array.isArray(a.dice)
      )
        return fail('No derived roll is pending.');
      if (s.chance?.kind === 'theft') {
        if (a.dice.length !== 1 || !integer(a.dice[0], s.chance.size + 1) || a.dice[0] < 1)
          return fail('Invalid derived selection.');
        return ok(
          { ...s, actor: s.chance.victim, net: { ...s.net, selection: (a.dice[0] as number) - 1 } },
          raw,
        );
      }
      const rolled = coreApply(s, { type: 'dice', actor: 'entropy', faces: a.dice });
      if (!rolled.ok) return rolled;
      return ok({ ...rolled.state, net: { ...s.net, roll: null, selection: null } }, raw);
    }
    const p = pending(s);
    if (p.type !== 'player' || p.seat !== a.actor) return fail('Another player must act.');
    const plan = selection(s);
    if (plan) {
      if (
        a.type !== 'transfer' ||
        !shape(a, ['type', 'actor', 'id', 'root', 'anchor', 'after', 'packets']) ||
        a.id !== plan.id ||
        !Array.isArray(a.packets) ||
        a.packets.length !== 2 ||
        ![a.root, a.anchor, a.after].every((n) => typeof n === 'string' && /^[0-9a-f]{64}$/.test(n))
      )
        return fail('Invalid transfer envelope.');
      const card = s.net.card;
      if ((s.net.mode === 'full' || s.net.viewer === plan.from || s.net.viewer === plan.to) && card === null)
        return fail('The private resource has not arrived.');
      const source = s.players[plan.from]?.goods ?? UNKNOWN;
      if (card !== null && !unknownGoods(source) && (source[card] ?? 0) < 1)
        return fail('The transferred resource is not in the hand.');
      const next = transferSupply(s, plan.from, plan.to, card, 1);
      return ok(
        {
          ...next,
          chance: null,
          stage: s.resume,
          actor: s.turn,
          net: { ...s.net, roll: null, selection: null, card: null },
        },
        raw,
      );
    }
    if (a.type === 'declare') {
      if (!shape(a, ['type', 'actor', 'landmarks']) || a.actor !== s.turn || !Array.isArray(a.landmarks))
        return fail('Victory is declared on your turn.');
      const actor = s.turn;
      const claims = a.landmarks as Learn[];
      let previous = -1;
      for (const claim of claims) {
        if (
          !claim ||
          !shape(claim as unknown as Record<string, unknown>, ['deck', 'pos', 'card']) ||
          claim.deck !== 'ventures' ||
          !integer(claim.pos, 25) ||
          claim.pos <= previous ||
          !integer(claim.card, 25) ||
          claim.card < 20
        )
          return fail('Invalid landmark claim.');
        const held = s.players[actor]?.ventures.find((v) => v.pos === claim.pos);
        if (!held || (held.card >= 0 && held.card !== claim.card)) return fail('The landmark is not held.');
        previous = claim.pos;
      }
      const scores = s.players.map((_, i) => prestige(s, i, false) + (i === actor ? claims.length : 0));
      if ((scores[actor] ?? 0) < 10) return fail('At least ten prestige is required.');
      const places = scores.map((n, i) =>
        i === actor ? 1 : 2 + scores.filter((m, j) => j !== actor && m > n).length,
      );
      const result: Outcome = { scores, places, reason: 'prestige' };
      return ok(
        {
          ...s,
          stage: 'over',
          chance: null,
          result,
          net: { ...s.net, landmarks: claims.map((c) => c.pos) },
          players: s.players.map((player, i) =>
            i !== actor
              ? player
              : {
                  ...player,
                  ventures: player.ventures.map((v) => ({
                    ...v,
                    card: claims.find((c) => c.pos === v.pos)?.card ?? v.card,
                  })),
                },
          ),
        },
        raw,
      );
    }
    if (a.type === 'dice' || a.type === 'theft' || a.type === 'transfer')
      return fail('A player cannot supply entropy.');
    let base: State = s,
      action: unknown = raw;
    if (a.type === 'play') {
      if (!shape(a, ['type', 'actor', 'pos', 'card', 'goods', 'resource']) || !integer(a.card, 20))
        return fail('A played venture must show its identity.');
      const held = s.players[p.seat]?.ventures.find((v) => v.pos === a.pos);
      if (!held || (held.card >= 0 && held.card !== a.card)) return fail('That venture is not held.');
      base = {
        ...s,
        players: s.players.map((player, i) =>
          i !== p.seat
            ? player
            : {
                ...player,
                ventures: player.ventures.map((v) =>
                  v.pos === a.pos ? { ...v, card: a.card as number } : v,
                ),
              },
        ),
      };
      const { card: _, ...rest } = a;
      action = rest;
    }
    const r = coreApply(base, action);
    if (!r.ok) return r;
    let net = s.net;
    if (r.state.chance && s.net.roll === null) {
      const id = s.net.rolls.length;
      const contributors = Array.from({ length: s.seats }, (_, i) => (p.seat + i + 1) % s.seats);
      net = {
        ...net,
        roll: id,
        rolls: [...net.rolls, { id, last: p.seat }],
        contributors,
        selection: null,
        card: null,
      };
    }
    const next = { ...r.state, net };
    if (next.bank.some((n) => n < 0 || n > 19) || next.players.some((_, i) => handCount(next, i) < 0))
      return fail('Public supply counts would be invalid.');
    return ok(next, raw);
  } catch {
    return fail('Unreadable action.');
  }
}
function legalActions(s: NetworkState, seat: number): readonly unknown[] {
  const p = pending(s);
  if (p.type !== 'player' || p.seat !== seat) return [];
  if (p.decision === 'contribute') return [{ type: 'contribute', actor: seat, id: s.net.roll }];
  const goods = s.players[seat]?.goods ?? UNKNOWN;
  if (unknownGoods(goods)) return [];
  const plan = selection(s);
  if (plan) return [{ type: 'transfer', actor: seat, id: plan.id }];
  if (s.stage === 'requisition')
    return [{ type: 'requisition-payment', actor: seat, amount: goods[s.requisition?.resource ?? 0] ?? 0 }];
  if (s.players[seat]?.ventures.some((v) => v.card < 0)) return [];
  if (seat === s.turn && prestige(s, seat) >= 10 && s.starter !== null && !s.stage.startsWith('setup'))
    return [
      {
        type: 'declare',
        actor: seat,
        landmarks:
          s.players[seat]?.ventures
            .filter((v) => v.card >= 20)
            .map((v) => ({ deck: 'ventures', pos: v.pos, card: v.card }))
            .sort((a, b) => a.pos - b.pos) ?? [],
      },
    ];
  return choices(s).map((a) =>
    a.type === 'play' ? { ...a, card: s.players[seat]?.ventures.find((v) => v.pos === a.pos)?.card } : a,
  );
}
function redact(s: NetworkState, viewer: number | null): NetworkState {
  return {
    ...s,
    publicCounts: s.players.map((_, i) => handCount(s, i)),
    ventureOrder: Array(25).fill(-1),
    net: { ...s.net, mode: 'view', viewer, card: null },
    players: s.players.map((p, i) => ({
      ...p,
      goods: i === viewer ? p.goods : UNKNOWN,
      ventures: p.ventures.map((v) => ({
        ...v,
        card: i === viewer || s.net.landmarks.includes(v.pos) ? v.card : -1,
      })),
    })),
  };
}
const reveals = (_s: NetworkState, raw: unknown): readonly Learn[] => {
  if (!raw || typeof raw !== 'object') return [];
  const a = raw as Record<string, unknown>;
  if (a.type === 'play' && integer(a.card, 20) && integer(a.pos, 25))
    return [{ deck: 'ventures', pos: a.pos, card: a.card }];
  return a.type === 'declare' && Array.isArray(a.landmarks) ? (a.landmarks as Learn[]) : [];
};
export const driftwrights: GameModule<NetworkState, NetworkEvent, DriftRules> = {
  id: 'driftwrights',
  version: '0.1.0',
  defaultRules: () => rules,
  validateRules: (raw) =>
    raw &&
    typeof raw === 'object' &&
    shape(raw as Record<string, unknown>, ['layout', 'windfall']) &&
    (raw as DriftRules).layout === 'classic' &&
    ['available', 'two'].includes((raw as DriftRules).windfall)
      ? { ok: true, value: { layout: 'classic', windfall: (raw as DriftRules).windfall } }
      : { ok: false, error: { code: 'rules', message: 'Invalid Driftwrights rules.' } },
  seatRange: () => ({ min: 3, max: 4 }),
  decks: () => [{ id: 'ventures', size: 25, promptShares: true }],
  setup,
  pending,
  legalActions,
  apply,
  learn,
  view: redact,
  knownTo: (s, seat) =>
    s.players[seat]?.ventures
      .filter((v) => v.card >= 0)
      .map((v) => ({ deck: 'ventures', pos: v.pos, card: v.card })) ?? [],
  dealt: (s) =>
    Array.from({ length: s.ventureNext }, (_, pos) => ({
      deck: 'ventures',
      pos,
      to:
        s.players.findIndex((p) => p.ventures.some((v) => v.pos === pos)) >= 0
          ? s.players.findIndex((p) => p.ventures.some((v) => v.pos === pos))
          : (s.usedVentures.find((v) => v.pos === pos)?.seat ?? 0),
    })),
  revealsOf: reveals,
  outcome: (s) => s.result,
  standings: (s) => s.result?.scores ?? s.players.map((_, i) => prestige(s, i, false)),
  invariants: (s) => [
    ...coreInvariants(s),
    ...(total(s.bank) + s.players.reduce((n, _, i) => n + handCount(s, i), 0) === 95
      ? []
      : ['public supply conservation']),
  ],
  rolls: (s) => s.net.rolls,
  beaconOf: (s, raw) =>
    raw && typeof raw === 'object' && (raw as { type: string }).type === 'contribute' ? s.net.roll : null,
  rollShape: (s) =>
    s.chance?.kind === 'theft' ? { count: 1, sides: s.chance.size } : { count: 2, sides: 6 },
  privateSelection: selection,
  resignAllowed: () => false,
  validateIntent: (s, seat, raw) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !['offer', 'discard'].includes((raw as Action).type) ||
      (raw as Action).actor !== seat ||
      unknownGoods(s.players[seat]?.goods ?? UNKNOWN) ||
      !legalActions(s, seat).length
    )
      return { ok: false, error: { code: 'intent', message: 'Invalid trade or discard intent.' } };
    const r = apply(s, raw);
    return r.ok ? { ok: true, value: raw } : r;
  },
};
