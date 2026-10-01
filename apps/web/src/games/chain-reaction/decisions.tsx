/*
 * One accessible form per decision kind. Each form submits an element of the decision's legal actions,
 * found by exact match; when nothing matches, submit is disabled and the form says why.
 */
import type { ChainReactionAction } from '@bored-games/chain-reaction';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Swatch } from './board.tsx';
import {
  buyCost,
  type ChainOption,
  type Decision,
  findDispose,
  findEndTurn,
  formatMoney,
  type HandTile,
} from './model.ts';

type Of<K extends Decision['kind']> = Extract<Decision, { kind: K }>;

interface FormProps<K extends Decision['kind']> {
  d: Of<K>;
  locked: boolean;
  submit: (a: ChainReactionAction) => void;
}

const onSubmit = (
  e: Event,
  a: ChainReactionAction | null,
  locked: boolean,
  submit: (a: ChainReactionAction) => void,
) => {
  e.preventDefault();
  if (a && !locked) submit(a);
};

function toCount(v: string): number {
  const n = Number(v);
  return v.trim() === '' ? 0 : Number.isInteger(n) ? n : Number.NaN;
}

function PlaceForm(
  props: FormProps<'place'> & {
    hand: readonly HandTile[];
    selected: number | null;
    onSelect: (t: number) => void;
  },
) {
  const { d, selected } = props;
  const chosen = d.options.find((o) => o.tile === selected) ?? null;
  const previewOf = (tile: number) => props.hand.find((h) => h.tile === tile)?.preview ?? '';
  return (
    <form onSubmit={(e) => onSubmit(e, chosen?.action ?? null, props.locked, props.submit)}>
      <fieldset class="cr-fieldset" disabled={props.locked}>
        <legend>Place a tile</legend>
        <p class="muted cr-hint">Pick a tile here or in your hand.</p>
        <div class="cr-options">
          {d.options.map((o) => (
            <label key={o.tile} class="cr-option">
              <input
                type="radio"
                name="cr-place"
                checked={selected === o.tile}
                onChange={() => props.onSelect(o.tile)}
              />
              <strong>{o.id}</strong>
              <span class="muted">{previewOf(o.tile)}</span>
            </label>
          ))}
        </div>
        <button type="submit" class="btn btn-primary" disabled={chosen === null}>
          {chosen ? `Place ${chosen.id}` : 'Place'}
        </button>
      </fieldset>
    </form>
  );
}

function SkipForm(props: FormProps<'skip'>) {
  return (
    <form onSubmit={(e) => onSubmit(e, props.d.action, props.locked, props.submit)}>
      <fieldset class="cr-fieldset" disabled={props.locked}>
        <legend>No playable tile</legend>
        <p>None of your tiles can be placed. Skip placing; you can still buy shares.</p>
        <button type="submit" class="btn btn-primary">
          Skip placing
        </button>
      </fieldset>
    </form>
  );
}

function ChainChoice(props: {
  name: string;
  legend: string;
  button: string;
  options: readonly ChainOption[];
  extra?: ComponentChildren;
  locked: boolean;
  submit: (a: ChainReactionAction) => void;
}) {
  const [picked, setPicked] = useState<string | null>(
    props.options.length === 1 ? (props.options[0]?.chain.id ?? null) : null,
  );
  const chosen = props.options.find((o) => o.chain.id === picked) ?? null;
  return (
    <form onSubmit={(e) => onSubmit(e, chosen?.action ?? null, props.locked, props.submit)}>
      <fieldset class="cr-fieldset" disabled={props.locked}>
        <legend>{props.legend}</legend>
        {props.extra}
        <div class="cr-options">
          {props.options.map((o) => (
            <label key={o.chain.id} class="cr-option">
              <input
                type="radio"
                name={props.name}
                checked={picked === o.chain.id}
                onChange={() => setPicked(o.chain.id)}
              />
              <Swatch chain={o.chain} />
              {o.chain.name}
            </label>
          ))}
        </div>
        <button type="submit" class="btn btn-primary" disabled={chosen === null}>
          {chosen ? `${props.button} ${chosen.chain.name}` : props.button}
        </button>
      </fieldset>
    </form>
  );
}

function OrderForm(props: FormProps<'order'>) {
  const [picked, setPicked] = useState(0);
  const chosen = props.d.options[picked] ?? null;
  return (
    <form onSubmit={(e) => onSubmit(e, chosen?.action ?? null, props.locked, props.submit)}>
      <fieldset class="cr-fieldset" disabled={props.locked}>
        <legend>Order the defunct chains</legend>
        <p class="muted cr-hint">Equal-size defunct chains resolve in the order you choose.</p>
        <div class="cr-options">
          {props.d.options.map((o, i) => (
            <label key={o.chains.map((c) => c.id).join()} class="cr-option">
              <input type="radio" name="cr-order" checked={picked === i} onChange={() => setPicked(i)} />
              {o.chains.map((c, j) => (
                <span key={c.id} class="cr-chain-name">
                  {j > 0 && <span aria-hidden="true">→</span>}
                  {j > 0 && <span class="sr-only">then</span>}
                  <Swatch chain={c} />
                  {c.name}
                </span>
              ))}
            </label>
          ))}
        </div>
        <button type="submit" class="btn btn-primary" disabled={chosen === null}>
          Confirm order
        </button>
      </fieldset>
    </form>
  );
}

function DisposeForm(props: FormProps<'dispose'>) {
  const { d } = props;
  const [sellText, setSell] = useState('0');
  const [tradeText, setTrade] = useState('0');
  const sell = toCount(sellText);
  const trade = toCount(tradeText);
  const match = findDispose(d, sell, trade);
  const keep = d.held - (Number.isNaN(sell) ? 0 : sell) - (Number.isNaN(trade) ? 0 : trade);
  let why = '';
  if (!match) {
    if (Number.isNaN(sell) || Number.isNaN(trade) || sell < 0 || trade < 0) why = 'Enter whole numbers.';
    else if (trade % 2 !== 0) why = 'Trades must be an even number of shares.';
    else if (sell + trade > d.held) why = `You hold only ${d.held} shares.`;
    else if (trade > d.maxTrade)
      why = `At most ${d.maxTrade} can be traded (the bank's ${d.survivor.name} supply).`;
    else why = 'That disposal is not allowed.';
  }
  return (
    <form onSubmit={(e) => onSubmit(e, match, props.locked, props.submit)}>
      <fieldset class="cr-fieldset" disabled={props.locked}>
        <legend class="cr-chain-name">
          Your <Swatch chain={d.chain} /> {d.chain.name} shares
        </legend>
        <p class="cr-hint">
          {d.chain.name} is defunct. You hold {d.held}. Sell at {formatMoney(d.price)} each, trade 2 for 1{' '}
          {d.survivor.name}, or keep them.
        </p>
        <div class="cr-numbers">
          <label class="cr-number">
            Sell
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={d.held}
              step={1}
              value={sellText}
              onInput={(e) => setSell(e.currentTarget.value)}
            />
          </label>
          <label class="cr-number">
            Trade
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={d.maxTrade}
              step={2}
              value={tradeText}
              onInput={(e) => setTrade(e.currentTarget.value)}
            />
          </label>
          <div class="cr-number">
            <span>Keep</span>
            <output>{Math.max(0, keep)}</output>
          </div>
        </div>
        <p class="cr-hint" aria-live="polite">
          {!match
            ? ''
            : sell + trade === 0
              ? `You keep all ${d.held}.`
              : `You receive ${formatMoney(sell * d.price)} and ${trade / 2} ${d.survivor.name} ${trade === 2 ? 'share' : 'shares'}.`}
        </p>
        <p class="error" role="alert">
          {why}
        </p>
        <button type="submit" class="btn btn-primary" disabled={match === null}>
          Confirm
        </button>
      </fieldset>
    </form>
  );
}

function EndTurnForm(props: FormProps<'endTurn'>) {
  const { d } = props;
  const [texts, setTexts] = useState<string[]>(() => d.chains.map(() => '0'));
  const [declare, setDeclare] = useState(false);
  const counts = texts.map(toCount);
  const match = findEndTurn(d, counts, declare && d.canDeclare);
  const total = counts.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
  const cost = buyCost(
    d,
    counts.map((n) => (Number.isNaN(n) ? 0 : n)),
  );
  let why = '';
  if (!match) {
    if (counts.some((n) => Number.isNaN(n) || n < 0)) why = 'Enter whole numbers.';
    else if (total > d.maxTotal) why = `At most ${d.maxTotal} shares per turn.`;
    else if (cost > d.cash) why = `That costs ${formatMoney(cost)}; you have ${formatMoney(d.cash)}.`;
    else {
      const short = d.chains.find((line, i) => (counts[i] ?? 0) > line.bank);
      why = short
        ? `The bank has only ${short.bank} ${short.chain.name} shares.`
        : 'That purchase is not allowed.';
    }
  }
  const setAt = (i: number, v: string) => setTexts(texts.map((t, j) => (j === i ? v : t)));
  return (
    <form onSubmit={(e) => onSubmit(e, match, props.locked, props.submit)}>
      <fieldset class="cr-fieldset" disabled={props.locked}>
        <legend>Buy shares and end your turn</legend>
        {d.chains.length === 0 ? (
          <p class="muted cr-hint">No chain is on the board, so there is nothing to buy.</p>
        ) : (
          <>
            <p class="muted cr-hint">
              Up to {d.maxTotal} shares in total. You have {formatMoney(d.cash)}.
            </p>
            <div class="cr-buys">
              {d.chains.map((line, i) => (
                <label key={line.chain.id} class="cr-buy">
                  <span class="cr-chain-name">
                    <Swatch chain={line.chain} />
                    {line.chain.name}
                  </span>
                  <span class="muted">
                    {formatMoney(line.price)} · {line.bank} left
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={line.max}
                    step={1}
                    disabled={line.max === 0}
                    value={texts[i]}
                    aria-label={`${line.chain.name} shares to buy`}
                    onInput={(e) => setAt(i, e.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
            <p class="cr-hint" aria-live="polite">
              {total} {total === 1 ? 'share' : 'shares'}, {formatMoney(cost)}
            </p>
          </>
        )}
        {d.discard.length > 0 && (
          <p class="cr-hint">
            Dead {d.discard.length === 1 ? 'tile' : 'tiles'} {d.discard.map((x) => x.tile).join(', ')} will be
            discarded and replaced.
          </p>
        )}
        {d.canDeclare && (
          <label class="check">
            <input type="checkbox" checked={declare} onChange={(e) => setDeclare(e.currentTarget.checked)} />
            Declare the end of the game{' '}
            {d.condition === 'endSize' ? '(a chain is large enough)' : '(every chain on the board is safe)'}
          </label>
        )}
        <p class="error" role="alert">
          {why}
        </p>
        <button type="submit" class="btn btn-primary" disabled={match === null}>
          {declare && d.canDeclare ? 'End turn and the game' : 'End turn'}
        </button>
      </fieldset>
    </form>
  );
}

/** The decision area: the form for the seat's current decision, or a waiting note. */
export function DecisionArea(props: {
  decision: Decision;
  waiting: string;
  locked: boolean;
  hand: readonly HandTile[];
  selected: number | null;
  onSelect: (tile: number) => void;
  submit: (a: ChainReactionAction) => void;
}) {
  const { decision: d, locked, submit } = props;
  switch (d.kind) {
    case 'wait':
      return <p class="muted">{props.waiting}</p>;
    case 'place':
      return (
        <PlaceForm
          d={d}
          locked={locked}
          submit={submit}
          hand={props.hand}
          selected={props.selected}
          onSelect={props.onSelect}
        />
      );
    case 'skip':
      return <SkipForm d={d} locked={locked} submit={submit} />;
    case 'found':
      return (
        <ChainChoice
          name="cr-found"
          legend="Found a chain"
          button="Found"
          options={d.options}
          locked={locked}
          submit={submit}
        />
      );
    case 'survivor':
      return (
        <ChainChoice
          name="cr-survivor"
          legend="Choose the surviving chain"
          button="Keep"
          options={d.options}
          extra={
            <p class="muted cr-hint">
              Tied for largest:{' '}
              {d.involved
                .filter((x) => d.options.some((o) => o.chain.id === x.chain.id))
                .map((x) => `${x.chain.name} (${x.size})`)
                .join(', ')}
              .
            </p>
          }
          locked={locked}
          submit={submit}
        />
      );
    case 'order':
      return <OrderForm d={d} locked={locked} submit={submit} />;
    case 'dispose':
      return <DisposeForm d={d} locked={locked} submit={submit} />;
    case 'endTurn':
      return <EndTurnForm d={d} locked={locked} submit={submit} />;
  }
}
