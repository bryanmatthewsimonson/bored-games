/*
 * The Current Affairs game screen (D091): the status line with the round, era, phase and player order; the panel of
 * the decision of the moment (the station market with its auction, the fuel yard with a purchase, the map for
 * wiring, payday's stations); the companies; and the history. Moves come from the legal list, or are composed and
 * checked with the engine's own helpers (an opening bid, a raise, a purchase or a scrap the list does not spell
 * out goes through `validateIntent`). `CurrentTable` draws everything from props, with no hooks, so a test can
 * render it; `CurrentAffairsGame` keeps the choices.
 */
import {
  burnOf,
  type Company,
  type CurrentAction,
  type CurrentState,
  capsOf,
  type Firing,
  FUELS,
  fits,
  pendingOf,
  SUBSTATIONS,
  stationOf,
  tableOf,
} from '@bored-games/current-affairs';
import { CURRENT_THEME as THEME } from '@bored-games/current-affairs/theme';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { FuelToken, FuelYard, Money, SEAT_COLORS, SEAT_INKS, SEAT_MARKS, StationCard } from './art.tsx';
import { CommonwealthMap } from './map.tsx';
import {
  basketOf,
  bestFiring,
  type CompanyRow,
  canAdd,
  cityName,
  companyRows,
  eraName,
  firingResult,
  fuelByStation,
  fuelName,
  fuelText,
  lastWired,
  listText,
  logLine,
  marketRows,
  money,
  nextPrice,
  type Offers,
  offersOf,
  phaseName,
  refuelBasket,
  regionName,
  roomOf,
  seatName,
  splitsOf,
  stackText,
  stationSpec,
  stationText,
  statusLine,
  stepBuy,
} from './model.ts';
import './current-affairs-game.css';

export const seatColor = (seat: number): string => SEAT_COLORS[seat] ?? '#777';
export const seatMark = (seat: number): string => SEAT_MARKS[seat] ?? String(seat + 1);

/** The choices a decision is being composed from; null means "the default". */
export interface Ui {
  /** The station picked to put up, and the opening bid typed for it. */
  readonly station: number | null;
  readonly bid: number | null;
  /** The raise typed while bidding. */
  readonly raise: number | null;
  /** The fuel basket. */
  readonly buy: readonly number[] | null;
  /** The station picked to scrap, and the fuel to keep. */
  readonly scrap: number | null;
  readonly keep: readonly number[] | null;
  /** The stations picked to fire, and the coal burnt on the hybrids. */
  readonly fire: readonly number[] | null;
  readonly hybridCoal: number | null;
}

export const EMPTY_UI: Ui = {
  station: null,
  bid: null,
  raise: null,
  buy: null,
  scrap: null,
  keep: null,
  fire: null,
  hybridCoal: null,
};

export interface TableProps {
  readonly state: CurrentState;
  readonly me: number | null;
  readonly names: readonly string[];
  readonly avatars: readonly ComponentChildren[];
  readonly legal: readonly CurrentAction[];
  readonly enabled: boolean;
  readonly ui: Ui;
  readonly onUi: (patch: Partial<Ui>) => void;
  readonly onSend: (a: CurrentAction) => void;
}

type Props = TableProps & { readonly offers: Offers };

/** A button that sends one move; `data-action` names it for tests. */
function Send(props: {
  action: CurrentAction;
  enabled: boolean;
  onSend: (a: CurrentAction) => void;
  children: ComponentChildren;
  primary?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      class={`btn ca-btn${props.primary ? ' btn-primary' : ''}`}
      data-action={JSON.stringify(props.action)}
      disabled={!props.enabled}
      aria-label={props.label}
      onClick={() => props.onSend(props.action)}
    >
      {props.children}
    </button>
  );
}

/** A company's colour and mark. */
export function SeatMark(props: { seat: number; size?: 'small' | 'large' }) {
  return (
    <span
      class={`ca-seat${props.size === 'large' ? ' ca-seat-large' : ''}`}
      style={{ background: seatColor(props.seat), color: SEAT_INKS[props.seat] ?? '#fff' }}
      aria-hidden="true"
    >
      {seatMark(props.seat)}
    </span>
  );
}

/** A number typed in a field, kept between `min` and `max`. */
function Amount(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  enabled: boolean;
  onChange: (n: number) => void;
}) {
  const set = (n: number) => props.onChange(Math.max(props.min, Math.min(props.max, n)));
  return (
    <span class="ca-amount">
      <button
        type="button"
        class="btn ca-mini"
        aria-label={`${props.label}: less`}
        disabled={!props.enabled || props.value <= props.min}
        onClick={() => set(props.value - 1)}
      >
        −
      </button>
      <label>
        <span class="sr-only">{props.label}</span>
        <span aria-hidden="true">$</span>
        <input
          type="number"
          inputMode="numeric"
          min={props.min}
          max={props.max}
          value={props.value}
          disabled={!props.enabled}
          onInput={(e) => {
            const n = Number.parseInt((e.currentTarget as HTMLInputElement).value, 10);
            if (Number.isFinite(n)) props.onChange(n);
          }}
        />
      </label>
      <button
        type="button"
        class="btn ca-mini"
        aria-label={`${props.label}: more`}
        disabled={!props.enabled || props.value >= props.max}
        onClick={() => set(props.value + 1)}
      >
        +
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------------------------- the market */

function Card(props: { n: number | 'era'; size: number; dim?: boolean; selected?: boolean }) {
  return (
    <span class="ca-cardwrap" title={props.n === 'era' ? 'The Era III card' : stationText(props.n)}>
      <StationCard
        n={props.n}
        size={props.size}
        dim={props.dim ?? false}
        selected={props.selected ?? false}
      />
    </span>
  );
}

/** One station of the market: a button when the viewer may put it up. */
function MarketCard(props: Props & { n: number; size: number }) {
  const { n, offers, ui, enabled, me } = props;
  const lot = props.state.lot;
  const picked = lot?.station === n || ui.station === n;
  if (me !== null && offers.opens.includes(n))
    return (
      <button
        type="button"
        class="ca-card-btn"
        aria-pressed={picked}
        aria-label={`Put up ${stationText(n)}`}
        data-station={n}
        disabled={!enabled}
        onClick={() => props.onUi({ station: n, bid: n })}
      >
        <StationCard n={n} size={props.size} selected={picked} />
      </button>
    );
  const dimmed = offers.opens.length > 0;
  return <Card n={n} size={props.size} dim={dimmed} selected={picked} />;
}

/** The auction under way: the station, the bid, who is still in, and the viewer's raise or fold. */
function Lot(props: Props) {
  const { state: s, me, offers, ui, enabled, names, onSend } = props;
  const lot = s.lot;
  if (lot === null) return null;
  const mine = me !== null && offers.fold;
  const cash = me === null ? 0 : (s.companies[me]?.money ?? 0);
  const raise = Math.max(lot.bid + 1, Math.min(cash, ui.raise ?? lot.bid + 1));
  return (
    <div class={`ca-lot${mine ? ' ca-alert' : ''}`} data-lot={lot.station}>
      <Card n={lot.station} size={96} selected />
      <div class="ca-lot-body">
        <p class="ca-lot-bid">
          <span>Bid</span> <Money amount={lot.bid} /> <span class="ca-by">by</span>{' '}
          <SeatMark seat={lot.leader} /> <bdi>{lot.leader === me ? 'you' : seatName(names, lot.leader)}</bdi>
        </p>
        <p class="ca-note">
          {stationText(lot.station)}. Put up by {lot.opener === me ? 'you' : seatName(names, lot.opener)}.
        </p>
        <ul class="ca-in" aria-label="Still bidding">
          {lot.active.map((seat) => (
            <li key={seat} class={seat === lot.turn ? 'ca-turn' : undefined}>
              <SeatMark seat={seat} /> <bdi>{seat === me ? 'You' : seatName(names, seat)}</bdi>
              {seat === lot.turn && <span class="ca-note"> to bid</span>}
            </li>
          ))}
        </ul>
        {mine && me !== null && (
          <div class="ca-actions">
            {offers.raises.map((amount) => (
              <Send
                key={amount}
                action={{ type: 'bid', actor: me, amount }}
                enabled={enabled}
                onSend={onSend}
                label={`Bid ${money(amount)}`}
              >
                +{amount - lot.bid} <span class="ca-note">({money(amount)})</span>
              </Send>
            ))}
            <span class="ca-sep" />
            <Amount
              label="Your bid"
              value={raise}
              min={lot.bid + 1}
              max={Math.max(lot.bid + 1, cash)}
              enabled={enabled}
              onChange={(n) => props.onUi({ raise: n })}
            />
            <Send
              action={{ type: 'bid', actor: me, amount: raise }}
              enabled={enabled && raise > lot.bid && raise <= cash}
              onSend={onSend}
              primary
            >
              Bid {money(raise)}
            </Send>
            <Send action={{ type: 'fold', actor: me }} enabled={enabled} onSend={onSend}>
              Fold
            </Send>
          </div>
        )}
      </div>
    </div>
  );
}

/** The viewer's turn to put a station up: the bid for the station picked, or a pass. */
function Opening(props: Props) {
  const { state: s, me, offers, ui, enabled, onSend } = props;
  if (me === null || offers.opens.length === 0) return null;
  const cash = s.companies[me]?.money ?? 0;
  const station = ui.station !== null && offers.opens.includes(ui.station) ? ui.station : null;
  const bid = station === null ? 0 : Math.max(station, Math.min(cash, ui.bid ?? station));
  return (
    <div class="ca-open ca-alert">
      {station === null ? (
        <p class="ca-hint">
          Choose a station on offer to put up for auction
          {s.round === 1 ? ': every company buys one in the first round.' : ', or pass for this round.'}
        </p>
      ) : (
        <>
          <p class="ca-hint">
            Station {station}: {stationSpec(station)}. The opening bid is at least {money(station)}; you have{' '}
            {money(cash)}.
          </p>
          <div class="ca-actions">
            <Amount
              label="Opening bid"
              value={bid}
              min={station}
              max={cash}
              enabled={enabled}
              onChange={(n) => props.onUi({ bid: n })}
            />
            <Send
              action={{ type: 'open', actor: me, station, bid }}
              enabled={enabled && bid >= station && bid <= cash}
              onSend={onSend}
              primary
            >
              Put it up at {money(bid)}
            </Send>
          </div>
        </>
      )}
      {offers.pass && (
        <div class="ca-actions">
          <Send action={{ type: 'pass', actor: me }} enabled={enabled} onSend={onSend}>
            Pass this round
          </Send>
        </div>
      )}
    </div>
  );
}

function MarketPanel(props: Props) {
  const { state: s, names } = props;
  const { offer, coming } = marketRows(s);
  const era = s.eraCardShown ? <Card n="era" size={78} /> : null;
  const done = s.phase === 'auction' ? s.auctionDone.flatMap((d, seat) => (d ? [seat] : [])) : [];
  return (
    <section class="ca-panel ca-market" aria-labelledby="ca-market-h">
      <div class="ca-panel-head">
        <h3 id="ca-market-h">{s.era === 3 ? 'Station market: all on offer' : 'Station market'}</h3>
        <p class="ca-note">{stackText(s)}</p>
      </div>
      <div class="ca-rows">
        <div class="ca-row">
          <h4>{s.era === 3 ? 'On offer' : 'On offer'}</h4>
          <div class="ca-cards">
            {offer.map((n) => (
              <MarketCard key={n} {...props} n={n} size={84} />
            ))}
            {s.era === 3 && era}
            {offer.length === 0 && <p class="ca-note">The market is empty.</p>}
          </div>
        </div>
        {(coming.length > 0 || (era !== null && s.era !== 3)) && (
          <div class="ca-row ca-coming">
            <h4>Coming up</h4>
            <div class="ca-cards">
              {coming.map((n) => (
                <Card key={n} n={n} size={70} />
              ))}
              {s.era !== 3 && era}
            </div>
          </div>
        )}
      </div>
      <Lot {...props} />
      <Opening {...props} />
      {done.length > 0 && s.lot === null && (
        <p class="ca-note">
          Done in this auction:{' '}
          {listText(done.map((seat) => (seat === props.me ? 'you' : seatName(names, seat))))}.
        </p>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------------------- scrapping */

function ScrapPanel(props: Props) {
  const { state: s, me, offers, ui, enabled, onSend } = props;
  if (me === null || offers.scraps.size === 0) return null;
  const c = s.companies[me] as Company;
  const choices = [...offers.scraps.keys()];
  const station = ui.scrap !== null && offers.scraps.has(ui.scrap) ? ui.scrap : (choices[0] as number);
  const fullest = [...(offers.scraps.get(station) ?? [])].sort(
    (a, b) => b.reduce((x, y) => x + y, 0) - a.reduce((x, y) => x + y, 0),
  )[0] ?? [0, 0, 0, 0];
  const keep = ui.keep ?? fullest;
  const rest = c.stations.filter((n) => n !== station);
  const valid = keep.every((k, r) => k <= (c.fuel[r] ?? 0)) && fits(keep, capsOf(rest));
  const lost = c.fuel.map((f, r) => f - (keep[r] ?? 0));
  const hasFuel = c.fuel.some((f) => f > 0);
  return (
    <section class="ca-panel ca-alert" aria-labelledby="ca-scrap-h">
      <h3 id="ca-scrap-h">Over the limit: scrap a station</h3>
      <p class="ca-note">
        A company keeps at most {tableOf(s).maxStations} stations. Scrap one of your older ones (never the new
        station {s.scrapping?.bought}). Its fuel moves to your other stations as far as they can hold it; the
        rest goes back to the supply.
      </p>
      <div class="ca-cards">
        {choices.map((n) => (
          <button
            key={n}
            type="button"
            class="ca-card-btn"
            aria-pressed={n === station}
            aria-label={`Scrap ${stationText(n)}`}
            disabled={!enabled}
            onClick={() => props.onUi({ scrap: n, keep: null })}
          >
            <StationCard n={n} size={78} selected={n === station} />
          </button>
        ))}
      </div>
      {hasFuel && (
        <fieldset class="ca-steppers" disabled={!enabled}>
          <legend class="sr-only">Fuel to keep</legend>
          {FUELS.map((f, r) =>
            (c.fuel[r] ?? 0) === 0 ? null : (
              <span key={f} class="ca-step">
                <FuelToken fuel={r} size={20} />
                <span>Keep {fuelName(r).toLowerCase()}</span>
                <button
                  type="button"
                  class="btn ca-mini"
                  aria-label={`Keep less ${fuelName(r).toLowerCase()}`}
                  disabled={!enabled || (keep[r] ?? 0) <= 0}
                  onClick={() => props.onUi({ keep: stepBuy(keep, r, -1) })}
                >
                  −
                </button>
                <output>{keep[r] ?? 0}</output>
                <button
                  type="button"
                  class="btn ca-mini"
                  aria-label={`Keep more ${fuelName(r).toLowerCase()}`}
                  disabled={!enabled || (keep[r] ?? 0) >= (c.fuel[r] ?? 0)}
                  onClick={() => props.onUi({ keep: stepBuy(keep, r, 1) })}
                >
                  +
                </button>
              </span>
            ),
          )}
        </fieldset>
      )}
      {!valid && <p class="ca-warn">Your other stations cannot hold that much.</p>}
      <div class="ca-actions">
        <Send
          action={{ type: 'scrap', actor: me, station, keep: [...keep] }}
          enabled={enabled && valid}
          onSend={onSend}
          primary
        >
          Scrap station {station}
          {lost.some((n) => n > 0) ? `, dropping ${fuelText(lost)}` : ''}
        </Send>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------------------- the fuel yard */

function Basket(props: Props) {
  const { state: s, me, ui, enabled, onSend } = props;
  if (me === null) return null;
  const c = s.companies[me] as Company;
  const refuel = refuelBasket(s, me);
  const buy = ui.buy ?? refuel ?? [0, 0, 0, 0];
  const { cost, problem } = basketOf(s, me, buy);
  const room = roomOf(c);
  return (
    <div class="ca-basket ca-alert">
      <h4>Your purchase</h4>
      <p class="ca-note">
        One purchase a turn, any mix; the cheapest units go first. You have {money(c.money)}; your stations
        can still store {fuelText(room)}
        {c.stations.some((n) => stationOf(n)?.kind === 'hybrid')
          ? ' (coal and oil share the coal-or-oil space)'
          : ''}
        .
      </p>
      <fieldset class="ca-steppers" disabled={!enabled}>
        <legend class="sr-only">Fuel to buy</legend>
        {FUELS.map((f, r) => {
          const next = nextPrice(s.yard, r, buy[r] ?? 0);
          return (
            <span key={f} class="ca-step">
              <FuelToken fuel={r} size={22} />
              <span class="ca-step-name">{fuelName(r)}</span>
              <button
                type="button"
                class="btn ca-mini"
                aria-label={`Less ${fuelName(r).toLowerCase()}`}
                disabled={!enabled || (buy[r] ?? 0) <= 0}
                onClick={() => props.onUi({ buy: stepBuy(buy, r, -1) })}
              >
                −
              </button>
              <output aria-label={`${fuelName(r)} to buy`}>{buy[r] ?? 0}</output>
              <button
                type="button"
                class="btn ca-mini"
                aria-label={`More ${fuelName(r).toLowerCase()}`}
                disabled={!enabled || !canAdd(s, me, buy, r)}
                onClick={() => props.onUi({ buy: stepBuy(buy, r, 1) })}
              >
                +
              </button>
              <span class="ca-note">{next === null ? 'none left' : `next ${money(next)}`}</span>
            </span>
          );
        })}
      </fieldset>
      <p class="ca-total">
        Total <Money amount={cost} />
        {problem !== null && (
          <span class={buy.every((k) => k === 0) ? 'ca-note' : 'ca-warn'}> {problem}</span>
        )}
      </p>
      <div class="ca-actions">
        {refuel !== null && (
          <button
            type="button"
            class="btn ca-btn"
            disabled={!enabled}
            onClick={() => props.onUi({ buy: refuel })}
          >
            Suggested: {fuelText(refuel)}
          </button>
        )}
        <button
          type="button"
          class="btn ca-btn"
          disabled={!enabled || buy.every((k) => k === 0)}
          onClick={() => props.onUi({ buy: [0, 0, 0, 0] })}
        >
          Clear
        </button>
        <Send
          action={{ type: 'fuel', actor: me, buy: [...buy] }}
          enabled={enabled && problem === null}
          onSend={onSend}
          primary
        >
          Buy for {money(cost)}
        </Send>
        <Send action={{ type: 'done', actor: me }} enabled={enabled} onSend={onSend}>
          Buy nothing
        </Send>
      </div>
    </div>
  );
}

function YardPanel(props: Props) {
  return (
    <section class="ca-panel ca-yard-panel" aria-labelledby="ca-yard-h">
      <div class="ca-panel-head">
        <h3 id="ca-yard-h">Fuel yard</h3>
        <p class="ca-note">Prices climb as the yard empties; it is restocked after each payday.</p>
      </div>
      <div class="ca-yard-body">
        <div class="ca-yard-art">
          <FuelYard yard={props.state.yard} />
        </div>
        {props.offers.fuel && <Basket {...props} />}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ the map */

function MapPanel(props: Props) {
  const { state: s, me, offers, enabled, names, onSend } = props;
  const wiring = me !== null && offers.builds.size > 0;
  const c = me === null ? undefined : s.companies[me];
  const cheapest = [...offers.builds.entries()]
    .sort((a, b) => a[1] - b[1] || cityName(a[0]).localeCompare(cityName(b[0])))
    .slice(0, 8);
  return (
    <section class="ca-panel ca-map-panel" aria-labelledby="ca-map-h">
      <div class="ca-panel-head">
        <h3 id="ca-map-h">{THEME.land.replace(/^the /, 'The ')}</h3>
        <p class="ca-note">
          {s.regions.length === 0
            ? 'The regions in play are being drawn.'
            : `In play: ${listText(s.regions.map(regionName))}. ${eraName(s.era)}: ${s.era === 1 ? 'one company' : `${s.era} companies`} a city.`}
        </p>
      </div>
      {wiring && me !== null && c !== undefined && (
        <div class="ca-wire ca-alert">
          <p class="ca-hint">
            Click a lit city to wire it: {money(10)}, {money(15)} or {money(20)} for the substation plus the
            cheapest lines from your network. You have {money(c.money)} and {SUBSTATIONS - c.cities.length}{' '}
            substations left.
          </p>
          <div class="ca-actions">
            {cheapest.map(([city, cost]) => (
              <Send
                key={city}
                action={{ type: 'build', actor: me, city }}
                enabled={enabled}
                onSend={onSend}
                label={`Wire ${cityName(city)} for ${money(cost)}`}
              >
                {cityName(city)} <span class="ca-note">{money(cost)}</span>
              </Send>
            ))}
            {offers.done && (
              <Send action={{ type: 'done', actor: me }} enabled={enabled} onSend={onSend} primary>
                Done wiring
              </Send>
            )}
          </div>
        </div>
      )}
      <div class="ca-map-wrap">
        <CommonwealthMap
          regions={s.regions}
          houses={s.houses}
          names={THEME.cities}
          {...(wiring && enabled && me !== null
            ? {
                offers: offers.builds,
                onCity: (city: number) => {
                  if (offers.builds.has(city)) onSend({ type: 'build', actor: me, city });
                },
              }
            : {})}
          highlight={lastWired(s)}
          seatNames={names}
        />
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------------------------- payday */

const sameSet = (a: readonly number[], b: readonly number[]): boolean => a.join(',') === b.join(',');

function PaydayPanel(props: Props) {
  const { state: s, me, offers, ui, enabled, onSend } = props;
  if (me === null || offers.firings.length === 0) return null;
  const c = s.companies[me] as Company;
  const best = bestFiring(c, offers.firings);
  const fire = ui.fire ?? best.stations;
  const splits = splitsOf(offers.firings, fire);
  const chosen: Firing | undefined =
    splits.find(
      (f) => f.hybridCoal === (ui.hybridCoal ?? (sameSet(fire, best.stations) ? best.hybridCoal : -1)),
    ) ?? splits[0];
  const result = chosen === undefined ? null : firingResult(c, chosen);
  const toggle = (n: number) => {
    const next = fire.includes(n) ? fire.filter((x) => x !== n) : [...fire, n].sort((a, b) => a - b);
    props.onUi({ fire: next, hybridCoal: null });
  };
  const stored = fuelByStation(c);
  return (
    <section class="ca-panel ca-alert" aria-labelledby="ca-pay-h">
      <h3 id="ca-pay-h">Payday: fire your stations</h3>
      <p class="ca-note">
        Each station you fire burns exactly its fuel and powers its cities, up to the {c.cities.length}{' '}
        {c.cities.length === 1 ? 'city' : 'cities'} you have wired. Choose the stations:
      </p>
      <div class="ca-cards">
        {c.stations.map((n) => (
          <button
            key={n}
            type="button"
            class="ca-card-btn ca-fire"
            aria-pressed={fire.includes(n)}
            aria-label={`Fire ${stationText(n)}`}
            disabled={!enabled}
            onClick={() => toggle(n)}
          >
            <StationCard n={n} size={84} selected={fire.includes(n)} dim={!fire.includes(n)} />
            <Stored fuel={stored.get(n) ?? [0, 0, 0, 0]} />
          </button>
        ))}
      </div>
      {splits.length > 1 && (
        <fieldset class="ca-split" disabled={!enabled}>
          <legend>On the coal-or-oil stations, burn</legend>
          {splits.map((f) => {
            const oil = burnOf(f).hybrid - f.hybridCoal;
            return (
              <label key={f.hybridCoal} class="ca-radio">
                <input
                  type="radio"
                  name="ca-split"
                  checked={chosen?.hybridCoal === f.hybridCoal}
                  onChange={() => props.onUi({ fire, hybridCoal: f.hybridCoal })}
                />{' '}
                {fuelText([f.hybridCoal, oil, 0, 0])}
              </label>
            );
          })}
        </fieldset>
      )}
      {chosen === undefined || result === null ? (
        <p class="ca-warn">Your fuel cannot fire those stations together.</p>
      ) : (
        <p class="ca-total">
          Powers {result.powered} {result.powered === 1 ? 'city' : 'cities'}, burning {fuelText(result.burn)}:
          paid <Money amount={result.pay} />
        </p>
      )}
      <div class="ca-actions">
        {chosen !== undefined && result !== null && (
          <Send
            action={{
              type: 'power',
              actor: me,
              stations: [...chosen.stations],
              hybridCoal: chosen.hybridCoal,
            }}
            enabled={enabled}
            onSend={onSend}
            primary
          >
            {chosen.stations.length === 0
              ? `Fire nothing and take ${money(result.pay)}`
              : `Fire and take ${money(result.pay)}`}
          </Send>
        )}
        {fire.length > 0 && (
          <button
            type="button"
            class="btn ca-btn"
            disabled={!enabled}
            onClick={() => props.onUi({ fire: best.stations, hybridCoal: best.hybridCoal })}
          >
            The best choice
          </button>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------------------- the companies */

function Stored(props: { fuel: readonly number[] }) {
  const tokens = props.fuel.flatMap((k, r) => Array.from({ length: k }, (_, i) => ({ r, key: `${r}-${i}` })));
  if (tokens.length === 0) return null;
  return (
    <span class="ca-stored" role="img" aria-label={`Stored: ${fuelText(props.fuel)}`}>
      {tokens.map((t) => (
        <FuelToken key={t.key} fuel={t.r} size={12} />
      ))}
    </span>
  );
}

function CompanyPanel(props: {
  s: CurrentState;
  row: CompanyRow;
  me: number | null;
  avatar: ComponentChildren;
}) {
  const { s, row, me } = props;
  const c = s.companies[row.seat] as Company;
  const stored = fuelByStation(c);
  const mine = row.seat === me;
  return (
    <section
      class={`ca-company${row.acting ? ' ca-acting' : ''}${mine ? ' ca-mine' : ''}`}
      style={{ '--ca-seat': seatColor(row.seat) }}
      aria-label={`${row.name}${mine ? ' (you)' : ''}`}
      data-seat={row.seat}
    >
      <header class="ca-company-head">
        <span class="ca-avatar">{props.avatar}</span>
        <SeatMark seat={row.seat} />
        <strong class="ca-company-name">
          <bdi>{row.name}</bdi>
          {mine && <span class="ca-note"> (you)</span>}
        </strong>
        {row.place !== null ? (
          <span class="ca-badge">#{row.place}</span>
        ) : (
          row.position > 0 && (
            <span class="ca-badge" title="Place in the player order">
              {row.position}
              {['st', 'nd', 'rd'][row.position - 1] ?? 'th'}
            </span>
          )
        )}
      </header>
      <dl class="ca-stats">
        <div>
          <dt>Money</dt>
          <dd>
            <Money amount={row.money} />
          </dd>
        </div>
        <div title={`${row.left} of ${SUBSTATIONS} substations left`}>
          <dt>Cities</dt>
          <dd>
            {row.cities}
            <small> / {SUBSTATIONS}</small>
          </dd>
        </div>
        <div>
          <dt>{s.phase === 'over' ? 'Powered' : 'Can power'}</dt>
          <dd>{row.canPower}</dd>
        </div>
      </dl>
      <div class="ca-owned">
        {row.stations.length === 0 ? (
          <p class="ca-note">No stations yet.</p>
        ) : (
          row.stations.map((n) => (
            <span key={n} class="ca-owned-st" title={stationText(n)}>
              <StationCard n={n} size={56} />
              <Stored fuel={stored.get(n) ?? [0, 0, 0, 0]} />
            </span>
          ))
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------- head and end */

function OrderStrip(props: {
  s: CurrentState;
  names: readonly string[];
  me: number | null;
  acting: number | null;
}) {
  const { s, names, me, acting } = props;
  return (
    <ol class="ca-order" aria-label="Player order">
      {s.order.map((seat) => (
        <li key={seat} class={seat === acting ? 'ca-turn' : undefined}>
          <SeatMark seat={seat} />
          <bdi>{seat === me ? 'You' : seatName(names, seat)}</bdi>
        </li>
      ))}
    </ol>
  );
}

function FinalResult(props: { s: CurrentState; names: readonly string[]; me: number | null }) {
  const { s, names, me } = props;
  if (s.result === null) return null;
  const seats = s.companies
    .map((_, seat) => seat)
    .sort((a, b) => (s.result?.places[a] ?? 0) - (s.result?.places[b] ?? 0));
  return (
    <section class="ca-panel ca-final" aria-labelledby="ca-final-h">
      <h3 id="ca-final-h">The final count</h3>
      <p class="ca-note">
        The most cities powered wins; a tie goes to the most money, then the most cities wired.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Place</th>
            <th scope="col">Company</th>
            <th scope="col">Powered</th>
            <th scope="col">Money</th>
            <th scope="col">Cities</th>
          </tr>
        </thead>
        <tbody>
          {seats.map((seat) => (
            <tr key={seat} class={s.result?.places[seat] === 1 ? 'ca-winner' : undefined}>
              <td>#{s.result?.places[seat]}</td>
              <th scope="row">
                <SeatMark seat={seat} /> <bdi>{seat === me ? 'You' : seatName(names, seat)}</bdi>
              </th>
              <td>
                <strong>{s.result?.scores[seat]}</strong>
              </td>
              <td>{money(s.companies[seat]?.money ?? 0)}</td>
              <td>{s.companies[seat]?.cities.length ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function History(props: { s: CurrentState; names: readonly string[] }) {
  const lines = props.s.history
    .map((e) => logLine(e, props.names))
    .filter((l) => l !== '')
    .slice(-18)
    .reverse();
  return (
    <section class="ca-panel ca-log" aria-labelledby="ca-log-h">
      <h3 id="ca-log-h">What happened</h3>
      <ol>
        {lines.map((l, i) => (
          <li key={`${props.s.history.length - i}`}>{l}</li>
        ))}
      </ol>
    </section>
  );
}

/** The whole table, from props: hook-free, so a test renders it. */
export function CurrentTable(props: TableProps) {
  const { state: s, me, names } = props;
  const offers = offersOf(s, me, props.legal);
  const p: Props = { ...props, offers };
  const rows = companyRows(s, names);
  const market = <MarketPanel key="market" {...p} />;
  const yard = <YardPanel key="yard" {...p} />;
  const map = <MapPanel key="map" {...p} />;
  const panels =
    s.phase === 'auction'
      ? [<ScrapPanel key="scrap" {...p} />, market, map, yard]
      : s.phase === 'fuel'
        ? [yard, map, market]
        : s.phase === 'power'
          ? [<PaydayPanel key="pay" {...p} />, map, market, yard]
          : s.phase === 'over'
            ? [<FinalResult key="final" s={s} names={names} me={me} />, map, market, yard]
            : [map, market, yard];
  return (
    <div class="ca-table">
      <div class="ca-main">{panels}</div>
      <aside class="ca-side" aria-label="Companies and history">
        {[...rows]
          .sort((a, b) => (a.seat === me ? -1 : b.seat === me ? 1 : a.position - b.position))
          .map((r) => (
            <CompanyPanel key={r.seat} s={s} row={r} me={me} avatar={props.avatars[r.seat]} />
          ))}
        <History s={s} names={names} />
      </aside>
    </div>
  );
}

export function CurrentAffairsGame(props: GameViewProps) {
  const s = props.view.state as CurrentState | null;
  const legal = props.legal as readonly CurrentAction[];
  const head = props.view.head.id;
  const [ui, setUi] = useState<Ui>(EMPTY_UI);
  const [error, setError] = useState<string | null>(null);
  // The head a move was sent at: the controls stay locked until the move lands or fails.
  const [sentAt, setSentAt] = useState<string | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  // A new head clears the choices of the last decision.
  useEffect(() => {
    setUi(EMPTY_UI);
  }, [head]);
  const enabled = props.canAct && !props.busy && sentAt !== head;

  if (s === null) return <p>Setting up the game…</p>;
  const me = props.mySeat;
  const ended = props.ended || s.phase === 'over';
  const pending = pendingOf(s);
  const acting = pending.type === 'player' && s.roll === null ? pending.seat : null;

  const send = async (a: CurrentAction): Promise<void> => {
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
      class="ca-game"
      aria-label={THEME.title}
      data-testid="ca-game"
      data-phase={s.phase}
      data-round={s.round}
      data-era={s.era}
      data-seq={props.view.head.seq}
      data-pending-seat={acting ?? 'none'}
      data-decision={pending.type === 'player' ? pending.decision : pending.type}
      data-my-seat={me ?? 'spectator'}
    >
      <header class="ca-head">
        <p class="ca-status" role="status">
          {props.ended && s.result === null ? 'The game has ended.' : statusLine(s, props.names, me)}
        </p>
        <div class="ca-strip">
          {s.round > 0 && <span class="ca-chip">Round {s.round}</span>}
          <span class="ca-chip">{eraName(s.era)}</span>
          <span class="ca-chip ca-chip-phase">{phaseName(s)}</span>
          <OrderStrip s={s} names={props.names} me={me} acting={ended ? null : acting} />
        </div>
        <p class="ca-meta">
          {props.deadline !== undefined && !ended && <span>{props.deadline}</span>}
          {props.notice !== undefined && <span>{props.notice}</span>}
          {legal.length > 0 && !props.canAct && !props.busy && !ended && props.lockedReason !== '' && (
            <span>{props.lockedReason}</span>
          )}
          {me !== null && (
            <span>
              Your company: <SeatMark seat={me} />
            </span>
          )}
          <a href={rulesHref('current-affairs')}>Rules</a>
        </p>
      </header>
      {error !== null && (
        <p class="ca-error" role="alert">
          {error}
        </p>
      )}
      <CurrentTable
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
