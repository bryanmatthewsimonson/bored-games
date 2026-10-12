/*
 * Attacks, dice, captures and the move in (RULES.md "Attack"). Pure. A battle's dice come from one beacon roll: the
 * action that fixes the last dice count opens it (the attack, or the defender's choice), and the faces are the
 * attacker's first, then the defender's.
 */
import { adjacent, neighbors, type ProvinceId } from './map.ts';
import { finish, nextTurn } from './turn.ts';
import type { Advance, HazardAction, HazardEvent, HazardState } from './types.ts';
import { type Applied, at, heldBy, withArray } from './util.ts';

/** Opens a roll; engine.ts owns it, and passes it in to keep this file free of an import cycle. */
type OpenRoll = (s: HazardState, seat: number, stage: 'roll') => HazardState;

const troopsAt = (s: HazardState, p: ProvinceId): number => s.troops[at(p)] ?? 0;
const ownerAt = (s: HazardState, p: ProvinceId): number | null => s.owner[at(p)] ?? null;
const range = (lo: number, hi: number): number[] =>
  Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

/** The most dice an attack from `from` may roll: three, and always one fewer than its troops. */
export const attackDice = (s: HazardState, from: ProvinceId): number => Math.min(3, troopsAt(s, from) - 1);
/** The most dice a defence of `to` may roll: two, and no more than its troops. */
export const defendDice = (s: HazardState, to: ProvinceId): number => Math.min(2, troopsAt(s, to));

export function battleLegal(s: HazardState, seat: number): HazardAction[] {
  switch (s.stage) {
    case 'attack': {
      const out: HazardAction[] = [];
      for (const from of heldBy(s, seat)) {
        if (troopsAt(s, from) < 2) continue;
        for (const to of neighbors(from)) {
          if (ownerAt(s, to) === seat) continue;
          for (const dice of range(1, attackDice(s, from)))
            out.push({ type: 'attack', actor: seat, from, to, dice });
        }
      }
      out.push({ type: 'endAttack', actor: seat });
      return out;
    }
    case 'defend':
      return s.battle === null
        ? []
        : range(1, defendDice(s, s.battle.to)).map((dice) => ({ type: 'defend', actor: seat, dice }));
    case 'advance':
      return s.advance === null
        ? []
        : range(s.advance.min, s.advance.max).map((count) => ({ type: 'advance', actor: seat, count }));
    case 'march': {
      const out: HazardAction[] = [];
      for (const from of heldBy(s, seat)) {
        const most = troopsAt(s, from) - 1;
        if (most < 1) continue;
        for (const to of neighbors(from)) {
          if (ownerAt(s, to) !== seat) continue;
          for (const count of [...new Set([1, most])])
            out.push({ type: 'march', actor: seat, from, to, count });
        }
      }
      out.push({ type: 'endTurn', actor: seat });
      return out;
    }
    default:
      return [];
  }
}

export function applyBattle(s: HazardState, a: HazardAction, openRoll: OpenRoll): Applied | string {
  switch (a.type) {
    case 'attack': {
      if (s.stage !== 'attack' || s.turn !== a.actor) return 'It is not your turn to attack.';
      if (ownerAt(s, a.from) !== a.actor) return 'Attack from your own province.';
      if (troopsAt(s, a.from) < 2) return 'Attack from a province with at least two troops.';
      if (!adjacent(a.from, a.to)) return 'Attack a province linked to it.';
      if (ownerAt(s, a.to) === a.actor) return 'Attack an enemy province.';
      const most = attackDice(s, a.from);
      if (a.dice < 1 || a.dice > most) return `Roll 1 to ${most} dice.`;
      const defenders = defendDice(s, a.to);
      const events: HazardEvent[] = [
        { type: 'attacked', seat: a.actor, from: a.from, to: a.to, dice: a.dice },
      ];
      if (s.rules.defense === 'auto' || defenders === 1) {
        const battle = { from: a.from, to: a.to, attack: a.dice, defend: defenders };
        return { state: openRoll({ ...s, battle }, a.actor, 'roll'), events };
      }
      return {
        state: { ...s, stage: 'defend', battle: { from: a.from, to: a.to, attack: a.dice, defend: null } },
        events,
      };
    }
    case 'defend': {
      const b = s.battle;
      if (s.stage !== 'defend' || b === null || ownerAt(s, b.to) !== a.actor)
        return 'There is no attack to defend.';
      const most = defendDice(s, b.to);
      if (a.dice < 1 || a.dice > most) return `Defend with 1 or ${most} dice.`;
      return {
        state: openRoll({ ...s, battle: { ...b, defend: a.dice } }, a.actor, 'roll'),
        events: [{ type: 'defended', seat: a.actor, dice: a.dice }],
      };
    }
    case 'rolled':
      return resolve(s, a.dice);
    case 'advance': {
      const adv = s.advance;
      if (s.stage !== 'advance' || adv === null || s.turn !== a.actor) return 'There is nothing to move in.';
      if (a.count < adv.min || a.count > adv.max) return `Move ${adv.min} to ${adv.max} troops.`;
      return moveIn(s, adv, a.count);
    }
    case 'march': {
      if (s.stage !== 'march' || s.turn !== a.actor) return 'It is not your turn to march.';
      if (ownerAt(s, a.from) !== a.actor || ownerAt(s, a.to) !== a.actor)
        return 'March between your own provinces.';
      if (!adjacent(a.from, a.to)) return 'March to a province linked to it.';
      const most = troopsAt(s, a.from) - 1;
      if (a.count < 1 || a.count > most) return `March 1 to ${most} troops.`;
      let troops = withArray(s.troops, at(a.from), troopsAt(s, a.from) - a.count);
      troops = withArray(troops, at(a.to), (troops[at(a.to)] ?? 0) + a.count);
      const next = nextTurn({ ...s, troops });
      return {
        state: next.state,
        events: [{ type: 'marched', seat: a.actor, from: a.from, to: a.to, count: a.count }, ...next.events],
      };
    }
    case 'endTurn': {
      if (s.stage !== 'march' || s.turn !== a.actor) return 'It is not your turn.';
      return nextTurn(s);
    }
    default:
      return 'That move is not possible now.';
  }
}

/** The battle's outcome: pairs compared high to high, ties to the defender. */
function resolve(s: HazardState, dice: readonly number[]): Applied | string {
  const b = s.battle;
  if (s.stage !== 'roll' || b === null || b.defend === null) return 'No battle is waiting for dice.';
  if (dice.length !== b.attack + b.defend) return 'The roll has the wrong number of dice.';
  const down = (xs: readonly number[]) => [...xs].sort((x, y) => y - x);
  const attack = down(dice.slice(0, b.attack));
  const defend = down(dice.slice(b.attack));
  let lostA = 0;
  let lostD = 0;
  for (let i = 0; i < Math.min(attack.length, defend.length); i++) {
    if ((attack[i] as number) > (defend[i] as number)) lostD++;
    else lostA++;
  }
  const from = at(b.from);
  const to = at(b.to);
  let troops = withArray(s.troops, from, (s.troops[from] ?? 0) - lostA);
  troops = withArray(troops, to, (troops[to] ?? 0) - lostD);
  const base: HazardState = {
    ...s,
    troops,
    roll: null,
    contributors: [],
    battle: null,
    dice: { attack, defend },
  };
  const events: HazardEvent[] = [
    { type: 'battle', seat: s.turn, from: b.from, to: b.to, attack, defend, lost: [lostA, lostD] },
  ];
  if ((troops[to] ?? 0) > 0) return { state: { ...base, stage: 'attack' }, events };
  // Captured: the province changes hands, and troops must move in.
  const advance: Advance = { from: b.from, to: b.to, min: b.attack, max: (troops[from] ?? 0) - 1 };
  const captured: HazardState = {
    ...base,
    owner: withArray(s.owner, to, s.turn),
    captured: true,
    advance,
    beaten: s.owner[to] ?? null,
  };
  events.push({ type: 'captured', seat: s.turn, from: b.from, to: b.to });
  if (advance.min === advance.max) {
    const moved = moveIn(captured, advance, advance.min);
    return { state: moved.state, events: [...events, ...moved.events] };
  }
  return { state: { ...captured, stage: 'advance' }, events };
}

function moveIn(s: HazardState, adv: Advance, count: number): Applied {
  const from = at(adv.from);
  const to = at(adv.to);
  let troops = withArray(s.troops, from, (s.troops[from] ?? 0) - count);
  troops = withArray(troops, to, (troops[to] ?? 0) + count);
  const moved: HazardState = { ...s, troops, advance: null, beaten: null, stage: 'attack' };
  const events: HazardEvent[] = [{ type: 'advanced', seat: s.turn, to: adv.to, count }];
  const after = afterCapture(moved, s.beaten);
  return { state: after.state, events: [...events, ...after.events] };
}

/**
 * After the move in: a seat left with no province is out, and its charters go to the conqueror, re-dealt privately
 * (D067). The world held: the game is over. Six or more charters: the conqueror cashes at once (RULES.md
 * "Eliminating a rival").
 */
function afterCapture(s: HazardState, beaten: number | null): Applied {
  const seat = s.turn;
  if (s.owner.every((o) => o === seat)) {
    const out = beaten === null || s.out.includes(beaten) ? s.out : [...s.out, beaten];
    return finish({ ...s, out }, seat);
  }
  if (beaten === null || s.owner.includes(beaten)) return { state: s, events: [] };
  const taken = s.hands[beaten] ?? [];
  const gained = taken.map((x) => ({ ...x, holders: [...x.holders, seat] }));
  let hands = withArray(s.hands, beaten, []);
  hands = withArray(hands, seat, [...(hands[seat] ?? []), ...gained]);
  const next: HazardState = {
    ...s,
    out: [...s.out, beaten],
    hands,
    dealt: [...s.dealt, ...taken.map((x) => ({ deck: 'pile', pos: x.pos, to: seat }))],
  };
  const events: HazardEvent[] = [{ type: 'eliminated', seat: beaten, by: seat, charters: taken.length }];
  if ((hands[seat]?.length ?? 0) >= 6)
    return { state: { ...next, stage: 'muster', midTurn: true, pool: 0 }, events };
  return { state: next, events };
}
