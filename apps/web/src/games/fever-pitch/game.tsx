/*
 * The Fever Pitch game screen (D096): the status line and the tracks (spread rate, spillovers, cures, the decks), the
 * chart of the world, the panel of the decision of the moment (moves by picking a city on the chart, the actions
 * where the pawn stands, the relief cards, a discard, the Early Warning order, a window's pass), the team with
 * every open hand, and the history. Every move is one of the legal list. `FeverTable` draws everything from props,
 * with no hooks, so a test or the preview capture can render it; `FeverPitchGame` keeps the choices.
 */
import {
  CITY_COUNT,
  type FeverAction,
  type FeverState,
  pendingOf,
  RELIEFS,
  reliefsHeld,
  roleOf,
  STRAIN_COUNT,
} from '@bored-games/fever-pitch';
import { FEVER_THEME as THEME } from '@bored-games/fever-pitch/theme';
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
import './fever-pitch.css';

/** The setup steps and the share owed out of turn, in this game's words (D060), for the registry. */
export const FEVER_SETUP_COPY: SetupCopy = {
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
  readonly state: FeverState;
  readonly me: number | null;
  readonly names: readonly string[];
  readonly avatars: readonly ComponentChildren[];
  readonly legal: readonly FeverAction[];
  readonly enabled: boolean;
  readonly ui: Ui;
  readonly onUi: (patch: Partial<Ui>) => void;
  readonly onSend: (a: FeverAction) => void;
}

const destination = (a: FeverAction): number | null =>
  'to' in a && typeof a.to === 'number' && a.type !== 'give' ? a.to : a.type === 'permit' ? a.city : null;

/** The cities the chart offers for the current choice, and the moves that reach each. */
function chartChoices(props: TableProps): Map<number, FeverAction[]> {
  const { legal, ui, me } = props;
  const offers = offersOf(legal);
  const out = new Map<number, FeverAction[]>();
  const add = (a: FeverAction) => {
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
      class={`fp-btn${props.kind ? ` fp-btn-${props.kind}` : ''}`}
      disabled={!props.enabled}
      data-testid={props.testid}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** The tracks: spread rate, spillovers, cures, case supply, the decks. */
function Tracks(props: { s: FeverState }) {
  const t = tracks(props.s);
  const s = props.s;
  return (
    <section class="fp-panel fp-tracks" aria-label="Tracks">
      <div class="fp-track">
        <span class="fp-track-label">Spread rate</span>
        <span class="fp-rate" role="img" aria-label={`Spread rate ${t.rate}`}>
          {[2, 2, 2, 3, 3, 4, 4].map((n, i) => (
            <span key={i} class={`fp-rate-step${i === t.rateIndex ? ' fp-rate-on' : ''}`}>
              {n}
            </span>
          ))}
        </span>
      </div>
      <div class="fp-track">
        <span class="fp-track-label">Spillovers</span>
        <span class="fp-spills" role="img" aria-label={`${t.spills} of 8 spillovers`} data-testid="fp-spills">
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              class={`fp-spill${i < t.spills ? ' fp-spill-on' : ''}${i === 7 ? ' fp-spill-last' : ''}`}
            />
          ))}
        </span>
      </div>
      <div class="fp-track">
        <span class="fp-track-label">Cures</span>
        <span class="fp-cures">
          {Array.from({ length: STRAIN_COUNT }, (_, k) => (
            <span
              key={k}
              class={`fp-cure${s.cured[k] ? ' fp-cure-on' : ''}`}
              title={`${strainName(k)}: ${s.stamped[k] ? 'stamped out' : s.cured[k] ? 'cured' : 'not cured'}`}
              style={{ borderColor: STRAIN_COLORS[k] }}
            >
              <StrainMark strain={k} size={20} />
              <span class="fp-cure-state">{s.stamped[k] ? 'out' : s.cured[k] ? 'cured' : ''}</span>
              <span class="fp-supply" title="case tokens left">
                {t.supply[k]} left
              </span>
            </span>
          ))}
        </span>
      </div>
      <div class="fp-track fp-decks">
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
  s: FeverState;
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
      class={`fp-panel fp-mate${active ? ' fp-mate-active' : ''}`}
      aria-label={`${seatName(props.names, seat)}${seat === props.me ? ' (you)' : ''}`}
      data-testid={`fp-seat-${seat}`}
    >
      <header class="fp-mate-head">
        {props.avatar}
        <Pawn seat={seat} />
        <strong>
          {seatName(props.names, seat)}
          {seat === props.me ? ' (you)' : ''}
        </strong>
        {role !== null && <RoleBadge role={role} size={24} />}
        <span class="fp-role-name">{roleName(role)}</span>
      </header>
      <p class="fp-mate-where">
        In {cityName(s.at[seat] ?? 0)} · {hand.length} card{hand.length === 1 ? '' : 's'}
        {hand.length > 7 ? ' (over the limit)' : ''}
      </p>
      {role !== null && <p class="fp-role-text">{THEME.roleText[role]}</p>}
      <div class="fp-hand">
        {hand.map((f) => (
          <FieldCard key={f} card={f} width={46} />
        ))}
        {stored !== null && (
          <span class="fp-stored" title="Stored on the role card">
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
  const send = (a: FeverAction) => enabled && props.onSend(a);
  const p = pendingOf(s);
  if (s.phase === 'over') {
    const won = s.result?.reason === 'cured';
    return (
      <section
        class={`fp-panel fp-final ${won ? 'fp-final-won' : 'fp-final-lost'}`}
        aria-label="Result"
        data-testid="fp-result"
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
      <section class="fp-panel fp-decision" aria-label="Decision">
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
      <section class="fp-panel fp-decision" aria-label="Early Warning">
        <h3>Early Warning: the next spread cards, top first</h3>
        <ol class="fp-order">
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
          testid="fp-arrange"
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
    <section class="fp-panel fp-decision" aria-label="Decision" data-testid="fp-decision">
      {offers.discards.length > 0 && (
        <div class="fp-group">
          <h3>Over the hand limit: discard a card</h3>
          <div class="fp-hand">
            {offers.discards.map((a) => (
              <button
                type="button"
                key={'card' in a ? a.card : 0}
                class="fp-card-btn"
                disabled={!enabled}
                data-testid="fp-discard"
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
        <div class="fp-group">
          <h3>
            {ui.relief === 'medevac'
              ? 'Medevac: pick a city'
              : ui.relief === 'permit'
                ? 'Field Permit: pick a city'
                : 'Move: pick a highlighted city on the chart'}
          </h3>
          {(isCoordinator || ui.relief === 'medevac') && (
            <fieldset class="fp-row fp-fieldset">
              <legend class="fp-legend">Pawn to move</legend>
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
            <div class="fp-row">
              {atCity.map((a, i) => (
                <Button key={i} kind="go" enabled={enabled} testid="fp-move" onClick={() => send(a)}>
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
        <div class="fp-group">
          <h3>Here in {cityName(s.at[me ?? 0] ?? 0)}</h3>
          <div class="fp-row">
            {offers.others.map((a, i) => (
              <Button
                key={i}
                enabled={enabled}
                kind={a.type === 'cure' ? 'go' : a.type === 'end' ? 'quiet' : undefined}
                testid={`fp-${a.type}`}
                onClick={() => send(a)}
              >
                {a.type === 'treat' && <CaseToken strain={a.strain} size={14} />} {moveText(a, s, names, me)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {offers.reliefs.length > 0 && (
        <div class="fp-group">
          <h3>Relief cards (no action)</h3>
          <div class="fp-row">
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
              <Button key={i} enabled={enabled} testid={`fp-${a.type}`} onClick={() => send(a)}>
                {moveText(a, s, names, me)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {offers.pass !== null && (
        <Button
          kind="quiet"
          testid="fp-pass"
          enabled={enabled}
          onClick={() => send(offers.pass as FeverAction)}
        >
          Pass: keep my relief cards
        </Button>
      )}
    </section>
  );
}

function History(props: { s: FeverState; names: readonly string[] }) {
  const lines = [...props.s.history].reverse().slice(0, 40);
  return (
    <section class="fp-panel fp-history" aria-label="History">
      <h3>History</h3>
      <ol>
        {lines.map((e, i) => (
          <li key={i} class={`fp-log fp-log-${e.kind}`}>
            {logLine(e, props.s, props.names)}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The whole table, from props: hook-free, so a test renders it. */
export function FeverTable(props: TableProps) {
  const { state: s, me, names } = props;
  const choices = chartChoices(props);
  const order = Array.from({ length: s.seats }, (_, i) => i).sort((a, b) =>
    a === me ? -1 : b === me ? 1 : a - b,
  );
  return (
    <div class="fp-board">
      <Tracks s={s} />
      <div class="fp-chart">
        <WorldMap
          state={s}
          targets={new Set(choices.keys())}
          selected={props.ui.city}
          onPick={(city) => props.onUi({ city })}
          names={names}
        />
      </div>
      <div class="fp-table">
        <div class="fp-main">
          <Decision {...props} />
          <History s={s} names={names} />
        </div>
        <aside class="fp-side" aria-label="The team">
          {order.map((seat) => (
            <Teammate key={seat} s={s} seat={seat} me={me} names={names} avatar={props.avatars[seat]} />
          ))}
        </aside>
      </div>
    </div>
  );
}

export function FeverPitchGame(props: GameViewProps) {
  const s = props.view.state as FeverState | null;
  const legal = props.legal as readonly FeverAction[];
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

  const send = async (a: FeverAction): Promise<void> => {
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
      class="fp-game"
      aria-label={THEME.title}
      data-testid="fp-game"
      data-phase={s.phase}
      data-turn={s.turnNo}
      data-seq={props.view.head.seq}
      data-pending-seat={acting ?? 'none'}
      data-decision={pending.type === 'player' ? pending.decision : pending.type}
      data-my-seat={me ?? 'spectator'}
    >
      <header class="fp-head">
        <p class="fp-status" role="status">
          {props.ended && s.result === null
            ? 'The team loses: the game ended early.'
            : statusLine(s, props.names, me)}
        </p>
        <p class="fp-meta">
          {s.turnNo > 0 && <span class="fp-chip">Turn {s.turnNo}</span>}
          <span class="fp-chip">{THEME.surgeLevels[s.rules.surges]}</span>
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
          <a href={rulesHref('fever-pitch')}>Rules</a>
        </p>
      </header>
      {error !== null && (
        <p class="fp-error" role="alert">
          {error}
        </p>
      )}
      <FeverTable
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
