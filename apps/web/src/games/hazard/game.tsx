/*
 * The Hazard game screen (D088): the status line, the atlas in the main column, the decision of the moment under
 * it (the first-player roll, claim, place, muster and cash, attack and its dice, the defence, the move in, the march),
 * the viewer's charters, and on the right the players, the next set's value, the last battle's dice and the log.
 * Moves are sent only from the legal list or through the module's intent check (a muster, a march or a move in of
 * any size). `HazardTable` draws everything from props, with no hooks, so a test can render it; `HazardGame` keeps
 * the selection.
 */
import {
  type HazardAction,
  type HazardEvent,
  type HazardState,
  PROVINCES,
  type ProvinceId,
} from '@bored-games/hazard';
import { HAZARD_THEME as THEME } from '@bored-games/hazard/theme';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps, SetupCopy } from '../types.ts';
import { Atlas } from './atlas.tsx';
import { CharterFace } from './charters.tsx';
import { Die } from './dice.tsx';
import {
  attackDiceFor,
  bonusFor,
  type Choices,
  cashGroups,
  choicesOf,
  handOf,
  logLine,
  mapMode,
  marchMost,
  nextSetValue,
  playerRows,
  provinceName,
  seatLook,
  seatName,
  selectionSurvives,
  statusLine,
} from './model.ts';
import './hazard.css';

/** The setup steps and the share owed out of turn, in this game's words (D060), for the registry. */
export const HAZARD_SETUP_COPY: SetupCopy = {
  shuffling: 'Shuffling the charters',
  dealing: 'Unrolling the atlas…',
  share: { act: 'unseal a charter', owed: 'a charter share' },
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A number picker for troops: − / value / +, bounded. */
export function Count(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  enabled: boolean;
  onChange: (n: number) => void;
}) {
  const { value, min, max } = props;
  return (
    <div class="hz-count">
      <span class="hz-count-label">{props.label}</span>
      <button
        type="button"
        class="btn hz-step"
        aria-label={`Fewer: ${props.label}`}
        disabled={!props.enabled || value <= min}
        onClick={() => props.onChange(clamp(value - 1, min, max))}
      >
        −
      </button>
      <input
        type="number"
        class="hz-count-input"
        aria-label={props.label}
        min={min}
        max={max}
        value={value}
        disabled={!props.enabled}
        onInput={(e) => props.onChange(clamp(Number((e.target as HTMLInputElement).value) || min, min, max))}
      />
      <button
        type="button"
        class="btn hz-step"
        aria-label={`More: ${props.label}`}
        disabled={!props.enabled || value >= max}
        onClick={() => props.onChange(clamp(value + 1, min, max))}
      >
        +
      </button>
      <button
        type="button"
        class="btn hz-step hz-step-all"
        disabled={!props.enabled || value === max}
        onClick={() => props.onChange(max)}
      >
        All {max}
      </button>
    </div>
  );
}

export interface TableProps {
  readonly state: HazardState;
  readonly me: number | null;
  readonly names: readonly string[];
  readonly avatars: readonly ComponentChildren[];
  readonly legal: readonly HazardAction[];
  readonly enabled: boolean;
  readonly selected: ProvinceId | null;
  readonly target: ProvinceId | null;
  /** The troops picked for a muster, a move in or a march, or null for the default (all of them). */
  readonly count: number | null;
  readonly events: readonly unknown[];
  readonly ended: boolean;
  readonly onPick: (p: ProvinceId) => void;
  readonly onSend: (a: HazardAction) => void;
  readonly onCount: (n: number) => void;
  readonly onClear: () => void;
}

function Button(props: {
  action: HazardAction;
  enabled: boolean;
  onSend: (a: HazardAction) => void;
  children: ComponentChildren;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      class={`btn hz-btn${props.primary ? ' hz-primary' : ''}`}
      data-action={JSON.stringify(props.action)}
      disabled={!props.enabled}
      onClick={() => props.onSend(props.action)}
    >
      {props.children}
    </button>
  );
}

/** The decision panel of the moment. */
function Decision(props: TableProps & { choices: Choices }) {
  const { state: s, me, choices: c, enabled, onSend } = props;
  if (me === null) return null;
  if (c.roll !== null)
    return (
      <section class="hz-panel" aria-labelledby="hz-decide">
        <h3 id="hz-decide">Who claims first?</h3>
        <p class="hz-note">Everyone rolls one die; the highest claims first and takes the first turn.</p>
        <Button action={c.roll} enabled={enabled} onSend={onSend} primary>
          Roll for the first claim
        </Button>
      </section>
    );
  if (c.claims.length > 0)
    return (
      <p class="hz-hint" role="status">
        Click an unclaimed province to claim it with one troop.
      </p>
    );
  if (c.places.length > 0)
    return (
      <p class="hz-hint" role="status">
        Click one of your provinces to place a troop ({s.reserve[me] ?? 0} left to place).
      </p>
    );
  if (c.defends.length > 0) {
    const b = s.battle;
    return (
      <section class="hz-panel hz-alert" aria-labelledby="hz-decide">
        <h3 id="hz-decide">You are attacked</h3>
        {b !== null && (
          <p>
            <bdi>{seatName(props.names, s.turn)}</bdi> attacks {provinceName(b.to)} from{' '}
            {provinceName(b.from)} with {b.attack} {b.attack === 1 ? 'die' : 'dice'}. Defend with:
          </p>
        )}
        <div class="hz-actions">
          {c.defends.map((a) => (
            <Button key={a.dice} action={a} enabled={enabled} onSend={onSend} primary={a.dice === 2}>
              {a.dice} {a.dice === 1 ? 'die' : 'dice'}
            </Button>
          ))}
        </div>
      </section>
    );
  }
  if (c.advances.length > 0) {
    const min = (c.advances[0] as { count: number }).count;
    const max = (c.advances.at(-1) as { count: number }).count;
    const count = clamp(props.count ?? max, min, max);
    return (
      <section class="hz-panel" aria-labelledby="hz-decide">
        <h3 id="hz-decide">Move in</h3>
        <p class="hz-note">At least the dice you rolled; one troop always stays behind.</p>
        <Count
          label="Troops to move in"
          value={count}
          min={min}
          max={max}
          enabled={enabled}
          onChange={props.onCount}
        />
        <Button action={{ type: 'advance', actor: me, count }} enabled={enabled} onSend={onSend} primary>
          Move in {count}
        </Button>
      </section>
    );
  }
  if (s.stage === 'muster' && (c.musters.length > 0 || c.cashes.length > 0)) {
    const groups = cashGroups(c);
    const forced = c.musters.length === 0;
    const count = clamp(props.count ?? s.pool, 1, Math.max(1, s.pool));
    return (
      <section class="hz-panel" aria-labelledby="hz-decide">
        <h3 id="hz-decide">
          {forced && s.midTurn ? 'Cash down to four charters' : `Muster: ${s.pool} troops`}
        </h3>
        {groups.length > 0 && (
          <div class="hz-sets">
            <p class="hz-note">
              {forced
                ? 'You must cash in a set before you place.'
                : `You may cash in a set for ${nextSetValue(s)} more troops.`}
            </p>
            {groups.map((g) => {
              const hand = handOf(s, me);
              const cards = g.positions.map((pos) => hand.find((x) => x.pos === pos)?.card ?? null);
              const known = cards.filter((x): x is number => x !== null);
              const bonus = bonusFor(s, me, known);
              return (
                <div key={g.positions.join()} class="hz-set">
                  <div class="hz-set-cards">
                    {cards.map((card, i) => (
                      <CharterFace key={g.positions[i]} card={card} small />
                    ))}
                  </div>
                  <div class="hz-actions">
                    {g.actions.map((a) => (
                      <Button key={a.bonus ?? 'none'} action={a} enabled={enabled} onSend={onSend}>
                        Cash in for {nextSetValue(s)}
                        {a.bonus === null ? '' : ` (+2 on ${provinceName(a.bonus)})`}
                      </Button>
                    ))}
                  </div>
                  {bonus.length > 1 && (
                    <p class="hz-note">Choose which held province takes the two extra troops.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {c.musters.length > 0 && (
          <>
            <Count
              label="Troops per click"
              value={count}
              min={1}
              max={s.pool}
              enabled={enabled}
              onChange={props.onCount}
            />
            <p class="hz-hint">
              Click one of your provinces to place {count === 1 ? 'one troop' : `${count} troops`} there.
            </p>
          </>
        )}
      </section>
    );
  }
  if (c.attacks.length > 0 || c.endAttack !== null) {
    const from = props.selected;
    const to = props.target;
    const dice = from !== null && to !== null ? attackDiceFor(c, from, to) : [];
    return (
      <section class="hz-panel" aria-labelledby="hz-decide">
        <h3 id="hz-decide">Attack</h3>
        {from === null ? (
          <p class="hz-hint">Click one of your provinces with two or more troops to attack from.</p>
        ) : to === null ? (
          <p class="hz-hint">Attack from {provinceName(from)}: click a highlighted enemy province.</p>
        ) : (
          <>
            <p>
              {provinceName(from)} ({s.troops[provinceIndexOf(from)]}) against {provinceName(to)} (
              {s.troops[provinceIndexOf(to)]}). Roll:
            </p>
            <div class="hz-actions">
              {dice.map((n) => (
                <Button
                  key={n}
                  action={{ type: 'attack', actor: me, from, to, dice: n }}
                  enabled={enabled}
                  onSend={onSend}
                  primary={n === dice.at(-1)}
                >
                  {n} {n === 1 ? 'die' : 'dice'}
                </Button>
              ))}
            </div>
          </>
        )}
        <div class="hz-actions">
          {from !== null && (
            <button type="button" class="btn hz-btn" disabled={!enabled} onClick={props.onClear}>
              Choose again
            </button>
          )}
          {c.endAttack !== null && (
            <Button action={c.endAttack} enabled={enabled} onSend={onSend}>
              {THEME.words.endAttack}
              {s.captured ? ' and draw a charter' : ''}
            </Button>
          )}
        </div>
      </section>
    );
  }
  if (c.marches.length > 0 || c.endTurn !== null) {
    const from = props.selected;
    const to = props.target;
    const most = from !== null && to !== null ? marchMost(c, from, to) : 0;
    const count = clamp(props.count ?? most, 1, Math.max(1, most));
    return (
      <section class="hz-panel" aria-labelledby="hz-decide">
        <h3 id="hz-decide">March</h3>
        {from === null ? (
          <p class="hz-hint">
            Once, you may move troops from one province to a linked one of yours. Click where from.
          </p>
        ) : to === null ? (
          <p class="hz-hint">March from {provinceName(from)}: click a highlighted province of yours.</p>
        ) : (
          <>
            <Count
              label={`Troops to ${provinceName(to)}`}
              value={count}
              min={1}
              max={most}
              enabled={enabled}
              onChange={props.onCount}
            />
            <Button
              action={{ type: 'march', actor: me, from, to, count }}
              enabled={enabled}
              onSend={onSend}
              primary
            >
              March {count}
            </Button>
          </>
        )}
        <div class="hz-actions">
          {from !== null && (
            <button type="button" class="btn hz-btn" disabled={!enabled} onClick={props.onClear}>
              Choose again
            </button>
          )}
          {c.endTurn !== null && (
            <Button action={c.endTurn} enabled={enabled} onSend={onSend}>
              End turn without marching
            </Button>
          )}
        </div>
      </section>
    );
  }
  return null;
}

const provinceIndexOf = (p: ProvinceId): number => PROVINCES.indexOf(p);

/** The whole table, from props: hook-free, so a test renders it. */
export function HazardTable(props: TableProps) {
  const { state: s, me, names } = props;
  const c = choicesOf(props.legal);
  const mode = mapMode(c, props.selected);
  const rows = playerRows(s, names);
  const hand = handOf(s, me);
  const lines = (props.events as HazardEvent[])
    .map((e) => logLine(e, names))
    .filter((x): x is string => x !== null)
    .slice(-14)
    .reverse();
  const outNotice = me !== null && s.out.includes(me) && !props.ended;
  const unsealed = hand.some((x) => x.card === null);
  return (
    <div class="hz-table">
      <div class="hz-main">
        {outNotice && (
          <p class="hz-out" role="status">
            You are out of the game. Keep this page open until it ends: every roll and every reshuffle needs a
            share from your app.
          </p>
        )}
        <Decision {...props} choices={c} />
        <div class="hz-atlas-wrap">
          <Atlas
            state={s}
            names={names}
            mode={mode}
            selected={props.selected}
            onPick={props.enabled ? props.onPick : undefined}
          />
        </div>
        {me !== null && (
          <section class="hz-panel" aria-labelledby="hz-hand">
            <h3 id="hz-hand">Your charters ({hand.length})</h3>
            {hand.length === 0 ? (
              <p class="hz-note">Take a province in a turn to earn a charter at its end.</p>
            ) : (
              <ul class="hz-hand">
                {hand.map((x) => (
                  <li key={x.pos}>
                    <CharterFace card={x.card} />
                  </li>
                ))}
              </ul>
            )}
            {unsealed && (
              <p class="hz-note">A new charter opens once the other players’ apps send their shares.</p>
            )}
          </section>
        )}
      </div>

      <aside class="hz-side" aria-label="Players and battle">
        <ol class="hz-players">
          {rows.map((r) => (
            <li
              key={r.seat}
              class={`hz-player${r.turn ? ' hz-player-turn' : ''}${r.out ? ' hz-player-out' : ''}`}
              data-seat={r.seat}
            >
              <span
                class={`hz-swatch hz-pat-${r.look.pattern}`}
                style={{ '--hz-seat': r.look.fill }}
                title={r.look.name}
              />
              <span class="hz-player-body">
                <span class="hz-player-name">
                  {props.avatars[r.seat]}
                  <strong>
                    <bdi>{r.name}</bdi>
                  </strong>
                  {r.seat === me ? ' (you)' : ''}
                </span>
                <span class="hz-player-facts">
                  {r.out
                    ? 'out'
                    : `${r.provinces} provinces · ${r.troops} troops · ${r.charters} ${r.charters === 1 ? 'charter' : 'charters'}`}
                  {r.turn ? ' · to play' : ''}
                </span>
                {r.realms.length > 0 && (
                  <span class="hz-player-realms">
                    Holds {r.realms.map((x) => THEME.realms[x]).join(', ')}
                  </span>
                )}
              </span>
              {r.place !== null && <span class="hz-place">#{r.place}</span>}
            </li>
          ))}
        </ol>
        <dl class="hz-facts">
          <dt>Next set</dt>
          <dd>{nextSetValue(s)} troops</dd>
          <dt>Charters in the pile</dt>
          <dd>{s.pile.length}</dd>
        </dl>
        {s.dice !== null && (
          <section class="hz-panel hz-dice" aria-label="The last battle's dice">
            <div class="hz-dice-row">
              {s.dice.attack.map((d, i) => (
                <Die key={`a${i}`} value={d} side="attack" />
              ))}
            </div>
            <div class="hz-dice-row">
              {s.dice.defend.map((d, i) => (
                <Die key={`d${i}`} value={d} side="defend" />
              ))}
            </div>
          </section>
        )}
        <section class="hz-log" aria-label="What happened">
          <ol>
            {lines.map((l, i) => (
              <li key={`${lines.length - i}`}>{l}</li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}

export function HazardGame(props: GameViewProps) {
  const s = props.view.state as HazardState | null;
  const legal = props.legal as readonly HazardAction[];
  const head = props.view.head.id;
  const [selected, setSelected] = useState<ProvinceId | null>(null);
  const [target, setTarget] = useState<ProvinceId | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The head a move was sent at: the controls stay locked until the move lands or fails.
  const [sentAt, setSentAt] = useState<string | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  // A new stage clears the count; a new turn, or a stage that is not part of an attack or the march, the choice.
  const stage = s?.stage;
  const turn = s?.turn;
  useEffect(() => {
    setCount(null);
    if (stage === undefined || !selectionSurvives(stage)) {
      setSelected(null);
      setTarget(null);
    }
  }, [stage]);
  useEffect(() => {
    setSelected(null);
    setTarget(null);
  }, [turn]);
  const enabled = props.canAct && !props.busy && sentAt !== head;

  if (s === null) return <p>Setting up the game…</p>;
  const me = props.mySeat;
  const ended = props.ended || s.stage === 'over';
  const c = choicesOf(legal);
  // A selection that the legal moves no longer allow (the stack fell to one troop) is dropped.
  const mode = mapMode(c, selected);
  const sel = selected !== null && mode.pick.includes(selected) ? selected : null;
  const tgt = sel !== null && target !== null && mapMode(c, sel).target.includes(target) ? target : null;

  const send = async (a: HazardAction): Promise<void> => {
    setError(null);
    setSentAt(head);
    try {
      await props.onAct(a);
      if (a.type === 'march' || a.type === 'endAttack' || a.type === 'endTurn') {
        setSelected(null);
        setTarget(null);
      }
    } catch (e) {
      setSentAt(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pick = (p: ProvinceId) => {
    if (me === null) return;
    const m = mapMode(c, sel);
    if (m.kind === 'claim') return void send({ type: 'claim', actor: me, province: p });
    if (m.kind === 'place') return void send({ type: 'place', actor: me, province: p });
    if (m.kind === 'muster') {
      const n = clamp(count ?? s.pool, 1, s.pool);
      return void send({ type: 'muster', actor: me, province: p, count: n });
    }
    if (m.target.includes(p)) {
      setTarget(p);
      setCount(null);
      return;
    }
    if (m.pick.includes(p)) {
      setSelected(p === sel ? null : p);
      setTarget(null);
      setCount(null);
    }
  };

  const pending = props.view.pending;
  return (
    <section
      class="hz-game"
      aria-label={THEME.title}
      data-testid="hz-game"
      data-stage={s.stage}
      data-turn={s.turn}
      data-seq={props.view.head.seq}
      data-pending-seat={pending.type === 'player' ? pending.seat : 'none'}
      data-my-seat={me ?? 'spectator'}
    >
      <header class="hz-head">
        <p class="hz-status" role="status" data-stage={s.stage}>
          {props.ended && s.result === null ? 'The game has ended.' : statusLine(s, props.names, me)}
        </p>
        <p class="hz-meta">
          {props.deadline !== undefined && !ended && <span>{props.deadline}</span>}
          {props.notice !== undefined && <span>{props.notice}</span>}
          {legal.length > 0 && !props.canAct && !props.busy && !ended && props.lockedReason !== '' && (
            <span>{props.lockedReason}</span>
          )}
          {me !== null && !ended && (
            <span>
              You play{' '}
              <span class="hz-you" style={{ color: seatLook(me).fill }}>
                {seatLook(me).name}
              </span>
            </span>
          )}
          <a href={rulesHref('hazard')}>Rules</a>
        </p>
      </header>
      {error !== null && (
        <p class="hz-error" role="alert">
          {error}
        </p>
      )}
      <HazardTable
        state={s}
        me={me}
        names={props.names}
        avatars={props.avatars}
        legal={legal}
        enabled={enabled}
        selected={sel}
        target={tgt}
        count={count}
        events={props.view.events}
        ended={ended}
        onPick={pick}
        onSend={(a) => void send(a)}
        onCount={setCount}
        onClear={() => {
          setSelected(null);
          setTarget(null);
          setCount(null);
        }}
      />
      {props.audit === 'pass' && (
        <p class="hz-note" role="status">
          Deck audit passed.
        </p>
      )}
      {typeof props.audit === 'object' && (
        <p class="hz-error" role="alert">
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
