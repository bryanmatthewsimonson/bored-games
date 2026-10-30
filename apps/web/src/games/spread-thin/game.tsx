/*
 * The Spread Thin game screen (D096): the status line and the tracks (spread rate, spillovers, cures, the decks), the
 * chart of the world, the panel of the decision of the moment (moves by picking a city on the chart, the actions
 * where the pawn stands, the relief cards, a discard, the Early Warning order, a window's pass), the team with
 * every open hand, and the history. Every move is one of the legal list. `SpreadTable` draws everything from props,
 * with no hooks, so a test or the preview capture can render it; `SpreadThinGame` keeps the choices.
 */
import {
  CITY_COUNT,
  pendingOf,
  RELIEFS,
  reliefsHeld,
  roleOf,
  type SpreadAction,
  type SpreadState,
  STRAIN_COUNT,
} from '@bored-games/spread-thin';
import { SPREAD_THEME as THEME } from '@bored-games/spread-thin/theme';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps, SetupCopy } from '../types.ts';
import { CaseToken, ClinicMark, FieldCard, Pawn, RoleBadge, STRAIN_COLORS, StrainMark } from './art.tsx';
import { WorldMap } from './map.tsx';
import {
  cityName,
  LOSS_TEXT,
  logLine,
  moveText,
  offersOf,
  roleName,
  seatName,
  statusLine,
  strainName,
  tracks,
} from './model.ts';
import './spread-thin.css';

/** The setup steps and the share owed out of turn, in this game's words (D060), for the registry. */
export const SPREAD_SETUP_COPY: SetupCopy = {
  shuffling: 'Shuffling the spread deck, the field deck and the roles',
  dealing: 'Dealing roles and hands, and seeding the first cases…',
  share: { act: 'turn up a card', owed: 'a card reveal' },
};

/** The choices a decision is being composed from. */
export interface Ui {
  /** The pawn whose moves the chart shows (the Coordinator may pick another). */
  readonly pawn: number | null;
  /** The city picked on the chart. */
  readonly city: number | null;
  /** A relief card being aimed at a city on the chart. */
  readonly relief: 'medevac' | 'permit' | null;
  /** The Early Warning order being built, top first. */
  readonly order: readonly number[] | null;
}

export const EMPTY_UI: Ui = { pawn: null, city: null, relief: null, order: null };

export interface TableProps {
  readonly state: SpreadState;
  readonly me: number | null;
  readonly names: readonly string[];
  readonly avatars: readonly ComponentChildren[];
  readonly legal: readonly SpreadAction[];
  readonly enabled: boolean;
  readonly ui: Ui;
  readonly onUi: (patch: Partial<Ui>) => void;
  readonly onSend: (a: SpreadAction) => void;
}

const destination = (a: SpreadAction): number | null =>
  'to' in a && typeof a.to === 'number' && a.type !== 'give' ? a.to : a.type === 'permit' ? a.city : null;

/** The cities the chart offers for the current choice, and the moves that reach each. */
function chartChoices(props: TableProps): Map<number, SpreadAction[]> {
  const { legal, ui, me } = props;
  const offers = offersOf(legal);
  const out = new Map<number, SpreadAction[]>();
  const add = (a: SpreadAction) => {
    const c = destination(a);
    if (c === null) return;
    out.set(c, [...(out.get(c) ?? []), a]);
  };
  if (ui.relief === 'medevac') {
    for (const a of offers.reliefs) if (a.type === 'medevac' && a.pawn === (ui.pawn ?? me)) add(a);
  } else if (ui.relief === 'permit') {
    for (const a of offers.reliefs) if (a.type === 'permit') add(a);
  } else {
    const pawn = ui.pawn ?? me;
    for (const a of offers.moves) if (!('pawn' in a) || a.pawn === pawn) add(a);
  }
  return out;
}

function Button(props: {
  onClick: () => void;
  enabled: boolean;
  children: ComponentChildren;
  kind?: string | undefined;
  testid?: string | undefined;
}) {
  return (
    <button
      type="button"
      class={`st-btn${props.kind ? ` st-btn-${props.kind}` : ''}`}
      disabled={!props.enabled}
      data-testid={props.testid}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** The tracks: spread rate, spillovers, cures, case supply, the decks. */
function Tracks(props: { s: SpreadState }) {
  const t = tracks(props.s);
  const s = props.s;
  return (
    <section class="st-panel st-tracks" aria-label="Tracks">
      <div class="st-track">
        <span class="st-track-label">Spread rate</span>
        <span class="st-rate" role="img" aria-label={`Spread rate ${t.rate}`}>
          {[2, 2, 2, 3, 3, 4, 4].map((n, i) => (
            <span key={i} class={`st-rate-step${i === t.rateIndex ? ' st-rate-on' : ''}`}>
              {n}
            </span>
          ))}
        </span>
      </div>
      <div class="st-track">
        <span class="st-track-label">Spillovers</span>
        <span class="st-spills" role="img" aria-label={`${t.spills} of 8 spillovers`} data-testid="st-spills">
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              class={`st-spill${i < t.spills ? ' st-spill-on' : ''}${i === 7 ? ' st-spill-last' : ''}`}
            />
          ))}
        </span>
      </div>
      <div class="st-track">
        <span class="st-track-label">Cures</span>
        <span class="st-cures">
          {Array.from({ length: STRAIN_COUNT }, (_, k) => (
            <span
              key={k}
              class={`st-cure${s.cured[k] ? ' st-cure-on' : ''}`}
              title={`${strainName(k)}: ${s.stamped[k] ? 'stamped out' : s.cured[k] ? 'cured' : 'not cured'}`}
              style={{ borderColor: STRAIN_COLORS[k] }}
            >
              <StrainMark strain={k} size={20} />
              <span class="st-cure-state">{s.stamped[k] ? 'out' : s.cured[k] ? 'cured' : ''}</span>
              <span class="st-supply" title="case tokens left">
                {t.supply[k]} left
              </span>
            </span>
          ))}
        </span>
      </div>
      <div class="st-track st-decks">
        <span>
          Field deck: <strong>{t.field}</strong> ({s.surgesDrawn} of {s.rules.surges} surges drawn)
        </span>
        <span>
          Spread deck: <strong>{t.pile}</strong>
        </span>
        <span>Spent: {s.spent.length === 0 ? 'none' : s.spent.map((x) => cityName(x.city)).join(', ')}</span>
      </div>
    </section>
  );
}

/** One teammate: role, pawn, place and open hand. */
function Teammate(props: {
  s: SpreadState;
  seat: number;
  me: number | null;
  names: readonly string[];
  avatar: ComponentChildren;
}) {
  const { s, seat } = props;
  const role = roleOf(s, seat);
  const hand = s.hands[seat] ?? [];
  const stored = s.stored[seat] ?? null;
  const active = s.turn === seat && s.phase !== 'over';
  return (
    <section
      class={`st-panel st-mate${active ? ' st-mate-active' : ''}`}
      aria-label={`${seatName(props.names, seat)}${seat === props.me ? ' (you)' : ''}`}
      data-testid={`st-seat-${seat}`}
    >
      <header class="st-mate-head">
        {props.avatar}
        <Pawn seat={seat} />
        <strong>
          {seatName(props.names, seat)}
          {seat === props.me ? ' (you)' : ''}
        </strong>
        {role !== null && <RoleBadge role={role} size={24} />}
        <span class="st-role-name">{roleName(role)}</span>
      </header>
      <p class="st-mate-where">
        In {cityName(s.at[seat] ?? 0)} · {hand.length} card{hand.length === 1 ? '' : 's'}
        {hand.length > 7 ? ' (over the limit)' : ''}
      </p>
      {role !== null && <p class="st-role-text">{THEME.roleText[role]}</p>}
      <div class="st-hand">
        {hand.map((f) => (
          <FieldCard key={f} card={f} width={46} />
        ))}
        {stored !== null && (
          <span class="st-stored" title="Stored on the role card">
            <FieldCard card={stored} width={46} />
          </span>
        )}
      </div>
    </section>
  );
}

/** The decision panel. */
function Decision(props: TableProps) {
  const { state: s, legal, ui, me, names, enabled } = props;
  const offers = offersOf(legal);
  const send = (a: SpreadAction) => enabled && props.onSend(a);
  const p = pendingOf(s);
  if (s.phase === 'over') {
    const won = s.result?.reason === 'cured';
    return (
      <section
        class={`st-panel st-final ${won ? 'st-final-won' : 'st-final-lost'}`}
        aria-label="Result"
        data-testid="st-result"
      >
        <h3>{won ? 'The team wins!' : 'The team loses.'}</h3>
        <p>
          {won
            ? 'All four cures were found.'
            : `The game ended: ${LOSS_TEXT[s.result?.reason ?? ''] ?? 'the game is over'}. Cures found: ${s.cured.filter(Boolean).length} of 4.`}
        </p>
      </section>
    );
  }
  if (legal.length === 0)
    return (
      <section class="st-panel st-decision" aria-label="Decision">
        <p>
          {p.type === 'player'
            ? `Waiting for ${seatName(names, p.seat)}.`
            : p.type === 'shuffle'
              ? 'Reshuffling the spent spread cards…'
              : 'Turning up cards…'}
        </p>
      </section>
    );
  if (offers.arranges.length > 0) {
    const top = s.pile.slice(0, s.arrange?.count ?? 0).map((x) => x.city as number);
    const order = ui.order ?? top;
    const swap = (i: number, j: number) => {
      const next = [...order];
      [next[i], next[j]] = [next[j] as number, next[i] as number];
      props.onUi({ order: next });
    };
    return (
      <section class="st-panel st-decision" aria-label="Early Warning">
        <h3>Early Warning: the next spread cards, top first</h3>
        <ol class="st-order">
          {order.map((c, i) => (
            <li key={c}>
              <StrainMark strain={Math.floor(c / 12)} size={16} /> {cityName(c)}
              <Button enabled={enabled && i > 0} onClick={() => swap(i, i - 1)}>
                ↑
              </Button>
              <Button enabled={enabled && i < order.length - 1} onClick={() => swap(i, i + 1)}>
                ↓
              </Button>
            </li>
          ))}
        </ol>
        <Button
          kind="go"
          testid="st-arrange"
          enabled={enabled}
          onClick={() => send({ type: 'arrange', actor: me ?? 0, order })}
        >
          Put them back in this order
        </Button>
      </section>
    );
  }
  const choices = chartChoices(props);
  const atCity = ui.city === null ? [] : (choices.get(ui.city) ?? []);
  const isCoordinator = me !== null && roleOf(s, me) === 'coordinator';
  const reliefButtons = offers.reliefs.filter((a) => a.type !== 'medevac' && a.type !== 'permit');
  const heldNames = me === null ? [] : reliefsHeld(s, me).map((f) => RELIEFS[f - CITY_COUNT]);
  return (
    <section class="st-panel st-decision" aria-label="Decision" data-testid="st-decision">
      {offers.discards.length > 0 && (
        <div class="st-group">
          <h3>Over the hand limit: discard a card</h3>
          <div class="st-hand">
            {offers.discards.map((a) => (
              <button
                type="button"
                key={'card' in a ? a.card : 0}
                class="st-card-btn"
                disabled={!enabled}
                data-testid="st-discard"
                aria-label={moveText(a, s, names, me)}
                onClick={() => send(a)}
              >
                <FieldCard card={'card' in a ? a.card : 0} width={52} />
              </button>
            ))}
          </div>
        </div>
      )}
      {(offers.moves.length > 0 || ui.relief !== null) && (
        <div class="st-group">
          <h3>
            {ui.relief === 'medevac'
              ? 'Medevac: pick a city'
              : ui.relief === 'permit'
                ? 'Field Permit: pick a city'
                : 'Move: pick a highlighted city on the chart'}
          </h3>
          {(isCoordinator || ui.relief === 'medevac') && (
            <fieldset class="st-row st-fieldset">
              <legend class="st-legend">Pawn to move</legend>
              {s.at.map((_, seat) => (
                <Button
                  key={seat}
                  enabled={enabled}
                  kind={(ui.pawn ?? me) === seat ? 'on' : undefined}
                  onClick={() => props.onUi({ pawn: seat, city: null })}
                >
                  <Pawn seat={seat} size={14} /> {seatName(names, seat)}
                </Button>
              ))}
            </fieldset>
          )}
          {ui.city !== null && atCity.length > 0 && (
            <div class="st-row">
              {atCity.map((a, i) => (
                <Button key={i} kind="go" enabled={enabled} testid="st-move" onClick={() => send(a)}>
                  {moveText(a, s, names, me)}
                </Button>
              ))}
            </div>
          )}
          {ui.relief !== null && (
            <Button enabled onClick={() => props.onUi({ relief: null, city: null, pawn: null })}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {offers.others.length > 0 && (
        <div class="st-group">
          <h3>Here in {cityName(s.at[me ?? 0] ?? 0)}</h3>
          <div class="st-row">
            {offers.others.map((a, i) => (
              <Button
                key={i}
                enabled={enabled}
                kind={a.type === 'cure' ? 'go' : a.type === 'end' ? 'quiet' : undefined}
                testid={`st-${a.type}`}
                onClick={() => send(a)}
              >
                {a.type === 'treat' && <CaseToken strain={a.strain} size={14} />} {moveText(a, s, names, me)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {offers.reliefs.length > 0 && (
        <div class="st-group">
          <h3>Relief cards (no action)</h3>
          <div class="st-row">
            {heldNames.includes('medevac') && offers.reliefs.some((a) => a.type === 'medevac') && (
              <Button enabled={enabled} onClick={() => props.onUi({ relief: 'medevac', city: null })}>
                {THEME.reliefs.medevac}…
              </Button>
            )}
            {offers.reliefs.some((a) => a.type === 'permit') && (
              <Button enabled={enabled} onClick={() => props.onUi({ relief: 'permit', city: null })}>
                {THEME.reliefs.permit}…
              </Button>
            )}
            {reliefButtons.map((a, i) => (
              <Button key={i} enabled={enabled} testid={`st-${a.type}`} onClick={() => send(a)}>
                {moveText(a, s, names, me)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {offers.pass !== null && (
        <Button
          kind="quiet"
          testid="st-pass"
          enabled={enabled}
          onClick={() => send(offers.pass as SpreadAction)}
        >
          Pass: keep my relief cards
        </Button>
      )}
    </section>
  );
}

function History(props: { s: SpreadState; names: readonly string[] }) {
  const lines = [...props.s.history].reverse().slice(0, 40);
  return (
    <section class="st-panel st-history" aria-label="History">
      <h3>History</h3>
      <ol>
        {lines.map((e, i) => (
          <li key={i} class={`st-log st-log-${e.kind}`}>
            {logLine(e, props.s, props.names)}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The whole table, from props: hook-free, so a test renders it. */
export function SpreadTable(props: TableProps) {
  const { state: s, me, names } = props;
  const choices = chartChoices(props);
  const order = Array.from({ length: s.seats }, (_, i) => i).sort((a, b) =>
    a === me ? -1 : b === me ? 1 : a - b,
  );
  return (
    <div class="st-board">
      <Tracks s={s} />
      <div class="st-chart">
        <WorldMap
          state={s}
          targets={new Set(choices.keys())}
          selected={props.ui.city}
          onPick={(city) => props.onUi({ city })}
          names={names}
        />
      </div>
      <div class="st-table">
        <div class="st-main">
          <Decision {...props} />
          <History s={s} names={names} />
        </div>
        <aside class="st-side" aria-label="The team">
          {order.map((seat) => (
            <Teammate key={seat} s={s} seat={seat} me={me} names={names} avatar={props.avatars[seat]} />
          ))}
        </aside>
      </div>
    </div>
  );
}

export function SpreadThinGame(props: GameViewProps) {
  const s = props.view.state as SpreadState | null;
  const legal = props.legal as readonly SpreadAction[];
  const head = props.view.head.id;
  const [ui, setUi] = useState<Ui>(EMPTY_UI);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  useEffect(() => {
    setUi(EMPTY_UI);
  }, [head]);
  const enabled = props.canAct && !props.busy && sentAt !== head;

  if (s === null) return <p>Setting up the game…</p>;
  const me = props.mySeat;
  const pending = pendingOf(s);
  const acting = pending.type === 'player' ? pending.seat : null;

  const send = async (a: SpreadAction): Promise<void> => {
    setError(null);
    setSentAt(head);
    try {
      await props.onAct(a);
    } catch (e) {
      setSentAt(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section
      class="st-game"
      aria-label={THEME.title}
      data-testid="st-game"
      data-phase={s.phase}
      data-turn={s.turnNo}
      data-seq={props.view.head.seq}
      data-pending-seat={acting ?? 'none'}
      data-decision={pending.type === 'player' ? pending.decision : pending.type}
      data-my-seat={me ?? 'spectator'}
    >
      <header class="st-head">
        <p class="st-status" role="status">
          {props.ended && s.result === null ? 'The game has ended.' : statusLine(s, props.names, me)}
        </p>
        <p class="st-meta">
          {s.turnNo > 0 && <span class="st-chip">Turn {s.turnNo}</span>}
          <span class="st-chip">{THEME.surgeLevels[s.rules.surges]}</span>
          {props.deadline !== undefined && !props.ended && <span>{props.deadline}</span>}
          {props.notice !== undefined && <span>{props.notice}</span>}
          {legal.length > 0 && !props.canAct && !props.busy && !props.ended && props.lockedReason !== '' && (
            <span>{props.lockedReason}</span>
          )}
          {me !== null && roleOf(s, me) !== null && (
            <span>
              You are the {roleName(roleOf(s, me))} <Pawn seat={me} size={14} />
            </span>
          )}
          <span>
            <ClinicMark size={14} /> {s.clinics.length} of 6 clinics
          </span>
          <a href={rulesHref('spread-thin')}>Rules</a>
        </p>
      </header>
      {error !== null && (
        <p class="st-error" role="alert">
          {error}
        </p>
      )}
      <SpreadTable
        state={s}
        me={me}
        names={props.names}
        avatars={props.avatars}
        legal={legal}
        enabled={enabled}
        ui={ui}
        onUi={(patch) => setUi((u) => ({ ...u, ...patch }))}
        onSend={(a) => void send(a)}
      />
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
