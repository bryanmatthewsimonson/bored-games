import { useEffect, useRef } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { Swatch } from './board.tsx';
import { type ChainRow, type ChainView, formatMoney, type PlayerRow, type ResultRow } from './model.ts';

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

export function PlayersPanel(props: { rows: readonly PlayerRow[]; chains: readonly ChainView[] }) {
  return (
    <section class="cr-panel" aria-labelledby="cr-players-h">
      <h2 id="cr-players-h">Players</h2>
      <ul class="cr-players">
        {props.rows.map((p) => {
          const held = props.chains.filter((c) => (p.shares[c.index] ?? 0) > 0);
          return (
            <li key={p.seat} class={`cr-player${p.acting ? ' cr-player-acting' : ''}`}>
              <div class="cr-player-head">
                <span class="cr-player-name">
                  {p.turn && (
                    <span class="cr-turn-mark" title="Their turn">
                      <span aria-hidden="true">▶</span>
                      <span class="sr-only">Current turn: </span>
                    </span>
                  )}
                  {p.name}
                  {p.me && <span class="chip">you</span>}
                  {p.acting && !p.turn && <span class="chip">deciding</span>}
                </span>
                <span class="cr-cash">{formatMoney(p.cash)}</span>
              </div>
              <div class="cr-player-meta">
                <span>{p.handSize === 1 ? '1 tile' : `${p.handSize} tiles`}</span>
                {held.length === 0 ? (
                  <span class="muted">no shares</span>
                ) : (
                  <ul class="cr-holdings" aria-label={`${p.name}'s shares`}>
                    {held.map((c) => (
                      <li key={c.id}>
                        <Swatch chain={c} />
                        <span class="sr-only">{c.name}: </span>
                        {p.shares[c.index]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
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
              <th scope="row">{r.name}</th>
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
