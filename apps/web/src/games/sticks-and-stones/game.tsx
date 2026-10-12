/*
 * The Sticks & Stones game screen (D089): the status line, the decision of the moment, the camp (the hunting
 * grounds, the four gathering grounds and the village, each with the people on it), the discovery display and the
 * monument sites, the viewer's clan, and on the right the clans, the last dice and the log. Moves are sent only from
 * the legal list. `SticksTable` draws everything from props, with no hooks, so a test can render it; `SticksGame`
 * keeps the selection.
 */
import {
  DISCOVERY_COUNT,
  GOOD_VALUES,
  GOODS,
  type Spot,
  type SticksAction,
  type SticksEvent,
  type SticksState,
  tally,
} from '@bored-games/sticks-and-stones';
import { STICKS_THEME as THEME } from '@bored-games/sticks-and-stones/theme';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps, SetupCopy } from '../types.ts';
import {
  CLAN_COLORS,
  Die,
  DiscoveryCard,
  GoodIcon,
  MonumentTile,
  PersonIcon,
  SpareToolIcon,
  SpotArt,
  ToolIcon,
} from './art.tsx';
import {
  BOARD_SPOTS,
  bottomText,
  type Choices,
  cardSpot,
  choicesOf,
  giftText,
  goodName,
  goodsText,
  isOption,
  logLine,
  occupants,
  type PlayerRow,
  playerRows,
  priceText,
  roomText,
  seatName,
  shortfallOf,
  spotName,
  stackLeft,
  stackSpot,
  statusLine,
  toolBonus,
  topText,
  yieldOf,
} from './model.ts';
import './sticks-and-stones.css';

/** The setup steps and the share owed out of turn, in this game's words (D060), for the registry. */
export const STICKS_SETUP_COPY: SetupCopy = {
  shuffling: 'Shuffling the discoveries and the monuments',
  dealing: 'Laying out the camp…',
  share: { act: 'turn up a card', owed: 'a card share' },
};

const clanColor = (seat: number): string => CLAN_COLORS[seat]?.fill ?? '#888';
const clanName = (seat: number): string => CLAN_COLORS[seat]?.name ?? '';

/** Goods chosen with a stepper per good, bounded by the options; `value` is one of them when it can be sent. */
export function GoodsPicker(props: {
  label: string;
  options: readonly (readonly number[])[];
  value: readonly number[];
  enabled: boolean;
  onChange: (pay: number[]) => void;
}) {
  const max = GOODS.map((_, i) => Math.max(0, ...props.options.map((o) => o[i] ?? 0)));
  return (
    <fieldset class="ss-picker" disabled={!props.enabled}>
      <legend>{props.label}</legend>
      {GOODS.map((g, i) =>
        (max[i] ?? 0) === 0 ? null : (
          <span key={g} class="ss-step">
            <GoodIcon good={i} size={22} />
            <button
              type="button"
              class="btn ss-mini"
              aria-label={`Less ${goodName(i).toLowerCase()}`}
              disabled={(props.value[i] ?? 0) <= 0}
              onClick={() => props.onChange(props.value.map((n, j) => (j === i ? n - 1 : n)))}
            >
              −
            </button>
            <output aria-label={goodName(i)}>{props.value[i] ?? 0}</output>
            <button
              type="button"
              class="btn ss-mini"
              aria-label={`More ${goodName(i).toLowerCase()}`}
              disabled={(props.value[i] ?? 0) >= (max[i] ?? 0)}
              onClick={() => props.onChange(props.value.map((n, j) => (j === i ? n + 1 : n)))}
            >
              +
            </button>
          </span>
        ),
      )}
    </fieldset>
  );
}

export interface TableProps {
  readonly state: SticksState;
  readonly me: number | null;
  readonly names: readonly string[];
  readonly avatars: readonly ComponentChildren[];
  readonly legal: readonly SticksAction[];
  readonly enabled: boolean;
  /** The spot picked for a placement with a count to choose. */
  readonly selected: Spot | null;
  /** The goods picked per decision (`buy:1`, `build:0`, `feed`, `choose`). */
  readonly pays: Readonly<Record<string, readonly number[]>>;
  /** The tool tiles and spares ticked for a roll. */
  readonly ticked: { readonly tools: readonly number[]; readonly spares: readonly number[] };
  readonly events: readonly unknown[];
  readonly ended: boolean;
  readonly onSelect: (spot: Spot | null) => void;
  readonly onPay: (key: string, pay: number[]) => void;
  readonly onTick: (kind: 'tools' | 'spares', i: number) => void;
  readonly onSend: (a: SticksAction) => void;
}

function Button(props: {
  action: SticksAction;
  enabled: boolean;
  onSend: (a: SticksAction) => void;
  children: ComponentChildren;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      class={`btn ss-btn${props.primary ? ' ss-primary' : ''}`}
      data-action={JSON.stringify(props.action)}
      disabled={!props.enabled}
      onClick={() => props.onSend(props.action)}
    >
      {props.children}
    </button>
  );
}

const worth = (pay: readonly number[]): number => pay.reduce((n, k, i) => n + k * (GOOD_VALUES[i] ?? 0), 0);

/**
 * The goods picked for `key`, or a default: the cheapest payment for a discovery or for food, the dearest for a
 * monument (it scores what it costs) and for a card that gives goods.
 */
function payOf(props: TableProps, key: string, options: readonly (readonly number[])[]): readonly number[] {
  const picked = props.pays[key];
  if (picked !== undefined) return picked;
  const dear = key === 'choose' || key.startsWith('build');
  const best = options.reduce<readonly number[] | undefined>(
    (x, y) => (x === undefined || (dear ? worth(y) > worth(x) : worth(y) < worth(x)) ? y : x),
    undefined,
  );
  return best ?? [0, 0, 0, 0];
}

/** A pay-or-pass decision for a discovery or a monument. */
function Purchase(
  props: TableProps & {
    kind: 'buy' | 'build';
    index: number;
    options: readonly (readonly number[])[];
    skip: boolean;
  },
) {
  const { me, kind, index, options, enabled, onSend } = props;
  if (me === null) return null;
  const key = `${kind}:${index}`;
  const pay = payOf(props, key, options);
  const valid = isOption(options, pay);
  const action: SticksAction =
    kind === 'buy'
      ? { type: 'buy', actor: me, slot: index, pay: [...pay] }
      : { type: 'build', actor: me, stack: index, pay: [...pay] };
  const spot = kind === 'buy' ? cardSpot(index) : stackSpot(index);
  const s = props.state;
  return (
    <div class="ss-purchase" data-spot={spot}>
      {kind === 'buy' ? (
        <DiscoveryCard card={s.display[index]?.card ?? null} small />
      ) : (
        <MonumentTile monument={(s.stacks[index]?.top ?? DISCOVERY_COUNT) - DISCOVERY_COUNT} small />
      )}
      <div class="ss-purchase-body">
        {options.length > 0 ? (
          <>
            <GoodsPicker
              label={
                kind === 'buy' ? `Pay ${index + 1} ${index === 0 ? 'good' : 'goods'}` : 'Pay for the monument'
              }
              options={options}
              value={pay}
              enabled={enabled}
              onChange={(p) => props.onPay(key, p)}
            />
            <Button action={action} enabled={enabled && valid} onSend={onSend} primary>
              {kind === 'buy' ? 'Take the discovery' : `Raise it${valid ? ` (${worth(pay)} points)` : ''}`}
            </Button>
          </>
        ) : (
          <p class="ss-note">You cannot pay for it.</p>
        )}
        {props.skip && (
          <Button action={{ type: 'skip', actor: me, spot }} enabled={enabled} onSend={onSend}>
            Pass it up
          </Button>
        )}
      </div>
    </div>
  );
}

/** The decision panel of the moment. */
function Decision(props: TableProps & { choices: Choices }) {
  const { state: s, me, choices: c, enabled, onSend } = props;
  if (me === null) return null;
  const chooser =
    c.chooses.length > 0 ? (
      <div class="ss-choose">
        <GoodsPicker
          label={`Use your card: ${THEME.words.choose}`}
          options={c.chooses}
          value={payOf(props, 'choose', c.chooses)}
          enabled={enabled}
          onChange={(p) => props.onPay('choose', p)}
        />
        <Button
          action={{ type: 'choose', actor: me, take: [...payOf(props, 'choose', c.chooses)] }}
          enabled={enabled && isOption(c.chooses, payOf(props, 'choose', c.chooses))}
          onSend={onSend}
        >
          Take {goodsText(payOf(props, 'choose', c.chooses))}
        </Button>
      </div>
    ) : null;

  if (c.places.size > 0) {
    const sel = props.selected;
    const counts = sel === null ? [] : (c.places.get(sel) ?? []);
    return (
      <section class="ss-panel" aria-labelledby="ss-decide">
        <h3 id="ss-decide">Send your people out ({s.home[me] ?? 0} at home)</h3>
        {counts.length > 1 && sel !== null ? (
          <>
            <p>How many go to {spotName(sel)}?</p>
            <div class="ss-actions">
              {counts.map((n) => (
                <Button
                  key={n}
                  action={{ type: 'place', actor: me, spot: sel, count: n }}
                  enabled={enabled}
                  onSend={onSend}
                >
                  {n}
                </Button>
              ))}
              <button
                type="button"
                class="btn ss-btn"
                disabled={!enabled}
                onClick={() => props.onSelect(null)}
              >
                Choose again
              </button>
            </div>
          </>
        ) : (
          <p class="ss-hint">Click a highlighted spot, a discovery or a monument site.</p>
        )}
        {chooser}
      </section>
    );
  }
  if (s.stage === 'tools' && c.tools.length > 0 && s.gather !== null) {
    const clan = s.clans[me];
    const dice = s.gather.dice ?? [];
    const chosen = c.tools.find(
      (a) => a.tools.join() === props.ticked.tools.join() && a.spares.join() === props.ticked.spares.join(),
    );
    const bonus = toolBonus(s, me, props.ticked);
    return (
      <section class="ss-panel" aria-labelledby="ss-decide">
        <h3 id="ss-decide">Add tools to the roll</h3>
        <div class="ss-dice-row">
          {dice.map((d, i) => (
            <Die key={`${i}-${d}`} value={d} size={34} />
          ))}
          <span class="ss-yield">
            = {dice.reduce((a, b) => a + b, 0)}
            {bonus > 0 ? ` + ${bonus}` : ''} → {yieldOf(dice, s.gather.good, bonus)}{' '}
            {goodName(s.gather.good).toLowerCase()}
          </span>
        </div>
        <div class="ss-tool-picks">
          {clan?.tools.map((v, i) =>
            clan.used[i] ? null : (
              <label key={`t${i}`} class="ss-check">
                <input
                  type="checkbox"
                  checked={props.ticked.tools.includes(i)}
                  disabled={!enabled}
                  onChange={() => props.onTick('tools', i)}
                />
                <ToolIcon value={v} size={30} /> Tool {v}
              </label>
            ),
          )}
          {clan?.spares.map((v, i) => (
            <label key={`s${i}`} class="ss-check">
              <input
                type="checkbox"
                checked={props.ticked.spares.includes(i)}
                disabled={!enabled}
                onChange={() => props.onTick('spares', i)}
              />
              <SpareToolIcon value={v} size={30} /> One-use {v}
            </label>
          ))}
        </div>
        {chosen && (
          <Button action={chosen} enabled={enabled} onSend={onSend} primary>
            {bonus > 0
              ? `Add ${bonus} and take ${yieldOf(dice, s.gather.good, bonus)}`
              : `Take ${yieldOf(dice, s.gather.good, 0)} without tools`}
          </Button>
        )}
      </section>
    );
  }
  if (c.picks.length > 0) {
    return (
      <section class="ss-panel ss-alert" aria-labelledby="ss-decide">
        <h3 id="ss-decide">{THEME.words.gift}: take a die</h3>
        <div class="ss-actions">
          {c.picks.map((face) => (
            <Button key={face} action={{ type: 'pick', actor: me, face }} enabled={enabled} onSend={onSend}>
              <Die value={face} size={26} /> {giftText(face)}
            </Button>
          ))}
        </div>
      </section>
    );
  }
  if (c.feeds.length > 0 || c.hungry) {
    const short = shortfallOf(s, me);
    const pay = payOf(props, 'feed', c.feeds);
    return (
      <section class="ss-panel ss-alert" aria-labelledby="ss-decide">
        <h3 id="ss-decide">Your clan lacks {short} food</h3>
        <p class="ss-note">
          All your food goes to the table. Pay the whole shortfall in goods, one good per food, or go hungry
          and lose 10 points.
        </p>
        {c.feeds.length > 0 && (
          <>
            <GoodsPicker
              label="Feed with goods"
              options={c.feeds}
              value={pay}
              enabled={enabled}
              onChange={(p) => props.onPay('feed', p)}
            />
            <Button
              action={{ type: 'feed', actor: me, pay: [...pay] }}
              enabled={enabled && isOption(c.feeds, pay)}
              onSend={onSend}
              primary
            >
              Feed with {goodsText(pay)}
            </Button>
          </>
        )}
        {c.hungry && (
          <Button action={{ type: 'feed', actor: me, pay: null }} enabled={enabled} onSend={onSend}>
            Go hungry (−10 points)
          </Button>
        )}
        {chooser}
      </section>
    );
  }
  const purchases = [
    ...c.buys.keys(),
    ...c.skips.flatMap((p) => (p.startsWith('card') ? [Number(p.slice(4))] : [])),
  ];
  const slots = [...new Set(purchases)].sort();
  const stacks = [
    ...new Set([
      ...c.builds.keys(),
      ...c.skips.flatMap((p) => (p.startsWith('stack') ? [Number(p.slice(5))] : [])),
    ]),
  ].sort();
  if (c.uses.length > 0 || slots.length > 0 || stacks.length > 0) {
    return (
      <section class="ss-panel" aria-labelledby="ss-decide">
        <h3 id="ss-decide">Bring your people home, in any order</h3>
        {c.uses.length > 0 && (
          <div class="ss-actions">
            {c.uses.map((spot) => (
              <Button key={spot} action={{ type: 'use', actor: me, spot }} enabled={enabled} onSend={onSend}>
                {spot === 'hut'
                  ? 'Hearth: a new person'
                  : spot === 'field'
                    ? 'Furrows: +1 harvest'
                    : spot === 'tools'
                      ? 'Knapper’s Rock: a tool'
                      : `Roll at ${spotName(spot)} (${s.spots[spot][me] ?? 0})`}
              </Button>
            ))}
          </div>
        )}
        {slots.map((slot) => (
          <Purchase
            key={`b${slot}`}
            {...props}
            kind="buy"
            index={slot}
            options={c.buys.get(slot) ?? []}
            skip={c.skips.includes(cardSpot(slot))}
          />
        ))}
        {stacks.map((k) => (
          <Purchase
            key={`m${k}`}
            {...props}
            kind="build"
            index={k}
            options={c.builds.get(k) ?? []}
            skip={c.skips.includes(stackSpot(k))}
          />
        ))}
        {chooser}
      </section>
    );
  }
  return chooser === null ? null : <section class="ss-panel">{chooser}</section>;
}

/** The people on a spot, as figures. */
function People(props: { s: SticksState; spot: Spot }) {
  const occ = occupants(props.s, props.spot);
  if (occ.length === 0) return null;
  return (
    <span class="ss-people">
      {occ.map(({ seat, count }) => (
        <span key={seat} class="ss-people-seat" title={`${clanName(seat)}: ${count}`}>
          <PersonIcon color={clanColor(seat)} size={18} />
          {count > 1 && <span class="ss-count">×{count}</span>}
        </span>
      ))}
    </span>
  );
}

/** The camp: the spots, the discovery display and the monument sites. */
function Camp(props: TableProps & { choices: Choices }) {
  const { state: s, choices: c, enabled, me } = props;
  const click = (spot: Spot): (() => void) | undefined => {
    if (!enabled || me === null) return undefined;
    const counts = c.places.get(spot);
    if (counts !== undefined && counts.length > 0) {
      if (counts.length === 1)
        return () => props.onSend({ type: 'place', actor: me, spot, count: counts[0] as number });
      return () => props.onSelect(spot);
    }
    if (c.uses.includes(spot)) return () => props.onSend({ type: 'use', actor: me, spot });
    return undefined;
  };
  const tile = (spot: Spot, body: ComponentChildren, extra?: string) => {
    const onClick = click(spot);
    const label = `${spotName(spot)}, ${roomText(s, spot)}`;
    const cls = `ss-spot${extra ? ` ${extra}` : ''}${onClick ? ' ss-open' : ''}${props.selected === spot ? ' ss-selected' : ''}`;
    return onClick ? (
      <button key={spot} type="button" class={cls} data-spot={spot} aria-label={label} onClick={onClick}>
        {body}
        <People s={s} spot={spot} />
      </button>
    ) : (
      <section key={spot} class={cls} data-spot={spot} aria-label={label}>
        {body}
        <People s={s} spot={spot} />
      </section>
    );
  };
  const left = stackLeft(s);
  return (
    <div class="ss-camp">
      <div class="ss-spots">
        {BOARD_SPOTS.map((spot) =>
          tile(
            spot,
            <>
              <SpotArt spot={spot} />
              <span class="ss-spot-name">{spotName(spot)}</span>
              <span class="ss-spot-room">{roomText(s, spot)}</span>
            </>,
          ),
        )}
      </div>
      <div class="ss-row">
        <section class="ss-display" aria-label="Discoveries">
          <h3>Discoveries</h3>
          <div class="ss-slots">
            {[3, 2, 1, 0].map((slot) => {
              const d = s.display[slot];
              const spot = cardSpot(slot);
              return tile(
                spot,
                <>
                  {d ? <DiscoveryCard card={d.card} small /> : <span class="ss-empty">Taken</span>}
                  <span class="ss-cost">
                    {slot + 1} {slot === 0 ? 'good' : 'goods'}
                  </span>
                </>,
                'ss-slot',
              );
            })}
          </div>
          <p class="ss-note">{DISCOVERY_COUNT - s.next} left in the pile</p>
        </section>
        <section class="ss-sites" aria-label="Monument sites">
          <h3>Monuments</h3>
          <div class="ss-slots">
            {s.stacks.map((st, k) =>
              tile(
                stackSpot(k),
                <>
                  {st.top !== null || (left[k] ?? 0) > 0 ? (
                    <MonumentTile monument={st.top === null ? null : st.top - DISCOVERY_COUNT} small />
                  ) : (
                    <span class="ss-empty">Empty</span>
                  )}
                  <span class="ss-cost">{left[k]} left</span>
                </>,
                'ss-site',
              ),
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function GoodsRow(props: { goods: readonly number[]; food?: number }) {
  return (
    <span class="ss-goods">
      {props.food !== undefined && (
        <span class="ss-good">
          <GoodIcon good={-1} size={16} title={THEME.words.food} />
          {props.food}
        </span>
      )}
      {props.goods.map((n, i) => (
        <span key={GOODS[i]} class={`ss-good${n === 0 ? ' ss-zero' : ''}`}>
          <GoodIcon good={i} size={16} title={goodName(i)} />
          {n}
        </span>
      ))}
    </span>
  );
}

function ClanRow(props: { r: PlayerRow; me: number | null; avatar: ComponentChildren }) {
  const { r } = props;
  return (
    <li class={`ss-player${r.turn ? ' ss-player-turn' : ''}`} data-seat={r.seat}>
      <span class="ss-swatch" style={{ '--ss-seat': clanColor(r.seat) }}>
        <PersonIcon color={clanColor(r.seat)} size={22} />
      </span>
      <span class="ss-player-body">
        <span class="ss-player-name">
          {props.avatar}
          <strong>
            <bdi>{r.name}</bdi>
          </strong>
          {r.seat === props.me ? ' (you)' : ''}
          {r.first ? (
            <span class="ss-first" title="First player this round">
              first
            </span>
          ) : null}
        </span>
        <span class="ss-player-facts">
          {r.score} on the track · {r.standing} if it ended now
          {r.turn ? ' · to play' : ''}
        </span>
        <span class="ss-player-facts">
          {r.people} {r.people === 1 ? THEME.words.person : THEME.words.people} ({r.home} home) · harvest{' '}
          {r.field}
        </span>
        <GoodsRow goods={r.goods} food={r.food} />
        <span class="ss-tools">
          {r.tools.map((v, i) => (
            <ToolIcon key={`t${i}`} value={v} used={r.used[i] ?? false} size={18} />
          ))}
          {r.spares.map((v, i) => (
            <SpareToolIcon key={`s${i}`} value={v} size={18} />
          ))}
          <span class="ss-player-facts">
            {r.cards.length} {r.cards.length === 1 ? THEME.words.discovery : THEME.words.discoveries}
            {r.hidden > 0 ? ` + ${r.hidden} face down` : ''} · {r.monuments.length}{' '}
            {r.monuments.length === 1 ? THEME.words.monument : THEME.words.monuments}
            {r.choices > 0 ? ' · two goods to take' : ''}
          </span>
        </span>
      </span>
      {r.place !== null && <span class="ss-place">#{r.place}</span>}
    </li>
  );
}

/** The viewer's own discoveries, face-down card and monuments. */
function MyClan(props: { s: SticksState; me: number }) {
  const c = props.s.clans[props.me];
  if (!c) return null;
  return (
    <section class="ss-panel" aria-labelledby="ss-mine">
      <h3 id="ss-mine">Your clan’s legacy</h3>
      {c.cards.length + c.hidden.length === 0 && c.monuments.length === 0 ? (
        <p class="ss-note">Take discoveries and raise monuments to build a legacy.</p>
      ) : (
        <ul class="ss-legacy">
          {c.cards.map((card) => (
            <li key={`c${card}`}>
              <DiscoveryCard card={card} small />
            </li>
          ))}
          {c.hidden.map((h) => (
            <li key={`h${h.pos}`} class="ss-hidden">
              <DiscoveryCard card={h.card} small />
              <span class="ss-note">
                {h.open ? 'Turned up' : h.card === null ? 'Opening…' : 'Face down: only you see it'}
              </span>
            </li>
          ))}
          {c.monuments.map((m) => (
            <li key={`m${m}`}>
              <MonumentTile monument={m} small />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The final count, clan by clan. */
function FinalCount(props: { s: SticksState; names: readonly string[] }) {
  const { s } = props;
  if (s.result === null) return null;
  return (
    <section class="ss-panel" aria-labelledby="ss-final">
      <h3 id="ss-final">The final count</h3>
      <table class="ss-final">
        <thead>
          <tr>
            <th scope="col">Clan</th>
            <th scope="col">Track</th>
            <th scope="col">Culture</th>
            <th scope="col">Figures</th>
            <th scope="col">Goods</th>
            <th scope="col">Total</th>
            <th scope="col">Place</th>
          </tr>
        </thead>
        <tbody>
          {s.clans.map((c, seat) => {
            const t = tally(c, s.rules, false);
            return (
              <tr key={seat}>
                <th scope="row">
                  <bdi>{seatName(props.names, seat)}</bdi>
                </th>
                <td>{t.track}</td>
                <td>{t.culture}</td>
                <td>{t.figures.reduce((a, b) => a + b, 0)}</td>
                <td>{t.goods}</td>
                <td>
                  <strong>{s.result?.scores[seat]}</strong>
                </td>
                <td>#{s.result?.places[seat]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The whole table, from props: hook-free, so a test renders it. */
export function SticksTable(props: TableProps) {
  const { state: s, me, names } = props;
  const c = choicesOf(props.legal);
  const rows = playerRows(s, names);
  const lines = (props.events as SticksEvent[])
    .map((e) => logLine(e, names))
    .filter((x): x is string => x !== null)
    .slice(-16)
    .reverse();
  return (
    <div class="ss-table">
      <div class="ss-main">
        <Decision {...props} choices={c} />
        <FinalCount s={s} names={names} />
        <Camp {...props} choices={c} />
        {me !== null && <MyClan s={s} me={me} />}
      </div>
      <aside class="ss-side" aria-label="Clans and dice">
        <ol class="ss-players">
          {rows.map((r) => (
            <ClanRow key={r.seat} r={r} me={me} avatar={props.avatars[r.seat]} />
          ))}
        </ol>
        {s.lastDice !== null && (
          <section class="ss-panel ss-dice" aria-label="The last roll">
            <p class="ss-note">Last roll, {seatName(names, s.lastDice.seat)}</p>
            <div class="ss-dice-row">
              {s.lastDice.dice.map((d, i) => (
                <Die key={`${i}-${d}`} value={d} size={28} />
              ))}
            </div>
          </section>
        )}
        <section class="ss-log" aria-label="What happened">
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

const EMPTY_TICK = { tools: [] as number[], spares: [] as number[] };

export function SticksGame(props: GameViewProps) {
  const s = props.view.state as SticksState | null;
  const legal = props.legal as readonly SticksAction[];
  const head = props.view.head.id;
  const [selected, setSelected] = useState<Spot | null>(null);
  const [pays, setPays] = useState<Record<string, number[]>>({});
  const [ticked, setTicked] = useState<{ tools: number[]; spares: number[] }>(EMPTY_TICK);
  const [error, setError] = useState<string | null>(null);
  // The head a move was sent at: the controls stay locked until the move lands or fails.
  const [sentAt, setSentAt] = useState<string | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  // A new head clears the choices of the last decision.
  useEffect(() => {
    setSelected(null);
    setPays({});
    setTicked(EMPTY_TICK);
  }, [head]);
  const enabled = props.canAct && !props.busy && sentAt !== head;

  if (s === null) return <p>Setting up the game…</p>;
  const me = props.mySeat;
  const ended = props.ended || s.stage === 'over';

  const send = async (a: SticksAction): Promise<void> => {
    setError(null);
    setSentAt(head);
    try {
      await props.onAct(a);
    } catch (e) {
      setSentAt(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const tick = (kind: 'tools' | 'spares', i: number) =>
    setTicked((t) => {
      const list = t[kind].includes(i)
        ? t[kind].filter((x) => x !== i)
        : [...t[kind], i].sort((a, b) => a - b);
      return { ...t, [kind]: list };
    });

  const pending = props.view.pending;
  return (
    <section
      class="ss-game"
      aria-label={THEME.title}
      data-testid="ss-game"
      data-stage={s.stage}
      data-turn={s.turn}
      data-round={s.round}
      data-seq={props.view.head.seq}
      data-pending-seat={pending.type === 'player' ? pending.seat : 'none'}
      data-my-seat={me ?? 'spectator'}
    >
      <header class="ss-head">
        <p class="ss-status" role="status" data-stage={s.stage}>
          {props.ended && s.result === null ? 'The game has ended.' : statusLine(s, props.names, me)}
        </p>
        <p class="ss-meta">
          {props.deadline !== undefined && !ended && <span>{props.deadline}</span>}
          {props.notice !== undefined && <span>{props.notice}</span>}
          {legal.length > 0 && !props.canAct && !props.busy && !ended && props.lockedReason !== '' && (
            <span>{props.lockedReason}</span>
          )}
          {me !== null && (
            <span>
              Your clan:{' '}
              <span class="ss-you" style={{ color: clanColor(me) }}>
                {clanName(me)}
              </span>
            </span>
          )}
          <a href={rulesHref('sticks-and-stones')}>Rules</a>
        </p>
      </header>
      {error !== null && (
        <p class="ss-error" role="alert">
          {error}
        </p>
      )}
      <SticksTable
        state={s}
        me={me}
        names={props.names}
        avatars={props.avatars}
        legal={legal}
        enabled={enabled}
        selected={selected}
        pays={pays}
        ticked={ticked}
        events={props.view.events}
        ended={ended}
        onSelect={setSelected}
        onPay={(key, pay) => setPays((p) => ({ ...p, [key]: pay }))}
        onTick={tick}
        onSend={(a) => void send(a)}
      />
      {props.audit === 'pass' && (
        <p class="ss-note" role="status">
          Deck audit passed.
        </p>
      )}
      {typeof props.audit === 'object' && (
        <p class="ss-error" role="alert">
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

export { bottomText, priceText, topText };
