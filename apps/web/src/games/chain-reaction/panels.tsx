import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { Swatch } from './board.tsx';
import { type ChainRow, formatMoney, type MyHoldings, type PlayerRow, type ResultRow } from './model.ts';

export type Audit = 'pending' | 'pass' | { readonly fail: readonly number[]; readonly reason: string };

export function ChainsPanel(props: { rows: readonly ChainRow[]; spectator: boolean }) {
  return (
    <section class="cr-panel" aria-labelledby="cr-chains-h">
      <h2 id="cr-chains-h">Chains</h2>
      <div class="cr-table-scroll">
        <table class="cr-table">
          <thead>
            <tr>
              <th scope="col">Chain</th>
              <th scope="col">Size</th>
              <th scope="col">Price</th>
              <th scope="col">Bank</th>
              {!props.spectator && <th scope="col">Mine</th>}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.chain.id} class={r.active ? undefined : 'cr-inactive'}>
                <th scope="row">
                  <span class="cr-chain-name">
                    <Swatch chain={r.chain} />
                    {r.chain.name}
                    {r.safe && <span class="cr-safe">safe</span>}
                  </span>
                </th>
                <td>{r.active ? r.size : '–'}</td>
                <td>{r.active ? formatMoney(r.price) : '–'}</td>
                <td>{r.bank}</td>
                {!props.spectator && <td>{r.mine ?? 0}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The viewer's own cash and shares, below their tiles (D043): the totals first, then one row per chain held,
 * valued at its current price. Never rendered for a spectator.
 */
export function HoldingsPanel(props: { holdings: MyHoldings }) {
  const h = props.holdings;
  return (
    <section class="cr-panel cr-mine" aria-labelledby="cr-mine-h">
      <h2 id="cr-mine-h">Your cash and shares</h2>
      <dl class="cr-mine-totals">
        <div>
          <dt>Cash</dt>
          <dd>{formatMoney(h.cash)}</dd>
        </div>
        <div>
          <dt>Shares</dt>
          <dd>{formatMoney(h.shareValue)}</dd>
        </div>
        <div class="cr-mine-net">
          <dt>Net worth</dt>
          <dd>{formatMoney(h.netWorth)}</dd>
        </div>
      </dl>
      {h.lines.length === 0 ? (
        <p class="muted cr-mine-none">You hold no shares yet.</p>
      ) : (
        <table class="cr-table cr-mine-table">
          <caption class="sr-only">Your shares at current prices</caption>
          <thead>
            <tr>
              <th scope="col">Chain</th>
              <th scope="col">Shares</th>
              <th scope="col">Price</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {h.lines.map((l) => (
              <tr key={l.chain.id} class={l.onBoard ? undefined : 'cr-inactive'}>
                <th scope="row">
                  <span class="cr-chain-name">
                    <Swatch chain={l.chain} />
                    {l.chain.name}
                  </span>
                </th>
                <td>{l.count}</td>
                {l.onBoard ? (
                  <>
                    <td>{formatMoney(l.price)}</td>
                    <td>{formatMoney(l.value)}</td>
                  </>
                ) : (
                  <td colSpan={2} class="cr-mine-off">
                    not on the board, worth $0
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="cr-hint muted cr-mine-note">
        Net worth is cash plus shares at today’s prices, before any bonuses.
      </p>
    </section>
  );
}

/**
 * One row per player. My own row is exact; for anyone else the row says only which chains they hold and
 * whether they have cash (RULES "Assets"), until the game is over. The rows carry no hidden numbers.
 * `avatars` (per seat, optional) are drawn beside the names; they are decorative, since the name is shown.
 */
export function PlayersPanel(props: {
  rows: readonly PlayerRow[];
  avatars?: readonly ComponentChildren[] | undefined;
}) {
  return (
    <section class="cr-panel" aria-labelledby="cr-players-h">
      <h2 id="cr-players-h">Players</h2>
      <ul class="cr-players">
        {props.rows.map((p) => (
          <li key={p.seat} class={`cr-player${p.acting ? ' cr-player-acting' : ''}`}>
            <div class="cr-player-head">
              <span class="cr-player-name">
                {props.avatars?.[p.seat]}
                {p.turn && (
                  <span class="cr-turn-mark" title="Their turn">
                    <span aria-hidden="true">▶</span>
                    <span class="sr-only">Current turn: </span>
                  </span>
                )}
                <span class="cr-player-label">{p.name}</span>
                {p.me && <span class="chip">you</span>}
                {p.acting && !p.turn && <span class="chip">deciding</span>}
              </span>
              {p.cash !== null ? (
                <span class="cr-cash">{formatMoney(p.cash)}</span>
              ) : (
                <span class={`cr-cash cr-cash-hidden${p.hasCash ? '' : ' muted'}`}>
                  {p.hasCash ? 'has cash' : 'no cash'}
                </span>
              )}
            </div>
            <div class="cr-player-meta">
              <span>{p.handSize === 1 ? '1 tile' : `${p.handSize} tiles`}</span>
              {p.shares.length === 0 ? (
                <span class="muted">no shares</span>
              ) : (
                <ul class="cr-holdings" aria-label={`${p.name}'s shares`}>
                  {p.shares.map((h) => (
                    <li key={h.chain.id}>
                      <Swatch chain={h.chain} />
                      {h.count === null ? (
                        <span class="sr-only">{h.chain.name}</span>
                      ) : (
                        <>
                          <span class="sr-only">{h.chain.name}: </span>
                          {h.count}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EventLog(props: { events: readonly string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Newest last: keep the latest line in view as lines arrive.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.events.length]);
  return (
    <section class="cr-panel" aria-labelledby="cr-log-h">
      <h2 id="cr-log-h">Log</h2>
      {props.events.length === 0 ? (
        <p class="muted">Nothing has happened yet.</p>
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the scrollable log must be keyboard scrollable.
        <div class="cr-log" ref={ref} role="log" tabIndex={0}>
          <ol>
            {props.events.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function AuditBadge(props: { audit: Audit; names: readonly string[] }) {
  const a = props.audit;
  if (a === 'pending') return <p class="cr-audit cr-audit-pending">Audit: checking the hidden moves…</p>;
  if (a === 'pass') return <p class="cr-audit cr-audit-pass">Audit passed: every hidden move checked out.</p>;
  const who = a.fail.map((s) => props.names[s] ?? `Seat ${s + 1}`).join(', ');
  return (
    <p class="cr-audit cr-audit-fail" role="alert">
      Audit failed{who ? ` for ${who}` : ''}: {a.reason}
    </p>
  );
}

export function ResultsView(props: {
  rows: readonly ResultRow[];
  audit: Audit | undefined;
  names: readonly string[];
  /** Per seat, drawn beside the names. */
  avatars?: readonly ComponentChildren[] | undefined;
}) {
  return (
    <section class="cr-panel cr-results" aria-labelledby="cr-results-h">
      <h2 id="cr-results-h">Final results</h2>
      <table class="cr-table">
        <thead>
          <tr>
            <th scope="col">Place</th>
            <th scope="col">Player</th>
            <th scope="col">Cash</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.seat} class={r.place === 1 ? 'cr-winner' : undefined}>
              <td>{r.place}</td>
              <th scope="row">
                <span class="cr-result-player">
                  {props.avatars?.[r.seat]}
                  <span class="cr-player-label">{r.name}</span>
                </span>
              </th>
              <td>{formatMoney(r.cash)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.audit !== undefined && <AuditBadge audit={props.audit} names={props.names} />}
    </section>
  );
}

export function StatusBar(props: {
  line: string;
  notice: string | undefined;
  deadline: string | undefined;
  onClaimTimeout: (() => void) | undefined;
  /** What a timeout claim would do, shown in its confirm step. */
  timeoutExplanation: string | undefined;
  busy: boolean;
}) {
  return (
    <div class="cr-status" role="status">
      <span class="cr-status-line">{props.line}</span>
      {props.busy && <span class="chip">Sending your move…</span>}
      {props.notice && <span class="chip">{props.notice}</span>}
      {props.deadline && <span class="chip">{props.deadline}</span>}
      {props.onClaimTimeout && (
        <ClaimTimeout
          explanation={props.timeoutExplanation ?? 'The stalled player forfeits.'}
          busy={props.busy}
          onClaim={props.onClaimTimeout}
        />
      )}
    </div>
  );
}
