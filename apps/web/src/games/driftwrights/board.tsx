import { type Action, BOARD, type Goods, type View } from '@bored-games/driftwrights';
import { DRIFTWRIGHTS_THEME as THEME } from '@bored-games/driftwrights/theme';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import './driftwrights.css';

const ATLAS = new URL('./island-atlas.png', import.meta.url).href;
const resource = (i: number) => THEME.resources[i] ?? 'Still Air';
const color = (seat: number) => THEME.colors[seat] ?? '#182f43';
const xy = (x: number, y: number): [number, number] => [380 + x * 72, 355 + y * 72];
export interface BoardProps {
  readonly state: View;
  readonly viewer: number | null;
  readonly actions: readonly Action[];
  readonly onAction: (action: Action) => void;
  readonly disabled?: boolean;
  readonly names: readonly string[];
}
function GoodsList({ goods }: { goods: Goods }) {
  return (
    <span class="drift-goods">
      {goods.map((n, i) => (
        <span key={i}>
          <b>{n}</b> {resource(i)}
        </span>
      ))}
    </span>
  );
}
export function actionLabel(a: Action): string {
  if (a.type === 'bank') return `Trade ${resource(a.give)} for ${resource(a.receive)}`;
  if (a.type === 'play')
    return a.goods
      ? `Supply Windfall: ${a.goods.flatMap((n, i) => (n ? [`${n} ${resource(i)}`] : [])).join(', ')}`
      : a.resource !== null
        ? `Requisition ${resource(a.resource)}`
        : `Play venture ${a.pos + 1}`;
  if (a.type === 'move-squall')
    return `Move Squall to island ${a.island + 1}${a.victim !== null ? `, take from player ${a.victim + 1}` : ''}`;
  return (
    {
      'request-roll': 'Roll dice',
      'finish-trade': 'Finish trading',
      'end-turn': 'End turn',
      'buy-venture': 'Buy venture',
      accept: 'Accept trade',
      decline: 'Decline trade',
      discard: 'Discard selected supplies',
      offer: 'Offer trade',
      hearth: 'Build hearth',
      hub: 'Upgrade hub',
      link: 'Build sky link',
    } as const
  )[a.type];
}
function MapTarget({
  action,
  active,
  label,
  submit,
  children,
}: {
  action: Action | undefined;
  active: boolean;
  label: string;
  submit: (a: Action) => void;
  children: ComponentChildren;
}) {
  if (!action) return <g>{children}</g>;
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG targets need a group; HTML buttons cannot wrap SVG geometry.
    <g
      role="button"
      tabIndex={active ? 0 : -1}
      aria-label={label}
      aria-disabled={!active}
      data-action={JSON.stringify(action)}
      class={active ? 'drift-target' : ''}
      onClick={() => submit(action)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          submit(action);
        }
      }}
    >
      {children}
    </g>
  );
}
export function DriftwrightsBoard(props: BoardProps) {
  const { state: s, viewer, actions, names } = props;
  const [discard, setDiscard] = useState<number[]>([0, 0, 0, 0, 0]);
  const [give, setGive] = useState<number[]>([0, 0, 0, 0, 0]);
  const [receive, setReceive] = useState<number[]>([0, 0, 0, 0, 0]);
  const [partner, setPartner] = useState(0);
  const [expandedMap, setExpandedMap] = useState(false);
  const active = !props.disabled && viewer === s.actor;
  const submit = (a: Action) => {
    if (active) {
      props.onAction(a);
    }
  };
  const makeButton = (a: Action) => (
    <button
      type="button"
      key={JSON.stringify(a)}
      data-action={JSON.stringify(a)}
      disabled={!active}
      onClick={() => submit(a)}
    >
      {actionLabel(a)}
    </button>
  );
  const mine = viewer === null ? null : s.players[viewer];
  const field = (values: number[], set: (xs: number[]) => void, label: string) =>
    THEME.resources.map((name, i) => (
      <label key={i}>
        {name}
        <input
          type="number"
          min="0"
          max="19"
          value={values[i]}
          aria-label={`${label} ${name}`}
          onInput={(e) => set(values.map((v, j) => (j === i ? Number(e.currentTarget.value) : v)))}
        />
      </label>
    ));
  return (
    <section class="drift-game" data-testid="driftwrights-board" data-stage={s.stage}>
      <header>
        <h2>{THEME.title}</h2>
        <p>{THEME.tagline}</p>
        <p role="status" data-testid="drift-status">
          {s.result
            ? `${names[s.result.places.indexOf(1)] ?? 'Player'} wins with ${s.result.scores[s.result.places.indexOf(1)]} prestige.`
            : s.stage === 'chance'
              ? 'Resolving chance…'
              : `${names[s.actor] ?? `Player ${s.actor + 1}`}: ${s.stage.replaceAll('-', ' ')}`}
        </p>
        {s.dice && (
          <p data-testid="drift-dice">
            Dice: {s.dice[0]} + {s.dice[1]} = {s.dice[0] + s.dice[1]}
          </p>
        )}
      </header>
      <div class="drift-layout">
        <div class="drift-map-wrap">
          <button
            type="button"
            class="drift-map-zoom"
            aria-pressed={expandedMap}
            onClick={() => setExpandedMap(!expandedMap)}
          >
            {expandedMap ? 'Fit map' : 'Enlarge map'}
          </button>
          <svg
            class={`drift-map${expandedMap ? ' drift-map-expanded' : ''}`}
            viewBox="0 0 760 730"
            aria-label="Floating island board"
          >
            <title>Driftwrights: islands, sites and sky-link lanes</title>
            <defs>
              {BOARD.islands.map((island, i) => {
                const [x, y] = xy(island.x, island.y);
                return (
                  <clipPath id={`drift-island-${i}`} key={i}>
                    <polygon
                      points={[30, 90, 150, 210, 270, 330]
                        .map(
                          (a) =>
                            `${x + 71 * Math.cos((a * Math.PI) / 180)},${y + 71 * Math.sin((a * Math.PI) / 180)}`,
                        )
                        .join(' ')}
                    />
                  </clipPath>
                );
              })}
            </defs>
            {BOARD.islands.map((island, i) => {
              const [x, y] = xy(island.x, island.y),
                type = s.terrain[i] ?? 5;
              return (
                <g key={i}>
                  <image
                    href={ATLAS}
                    x={x - 72 - (type % 3) * 144}
                    y={y - 72 - Math.floor(type / 3) * 144}
                    width="432"
                    height="288"
                    clip-path={`url(#drift-island-${i})`}
                  />
                  <text x={x} y={y - 48} class="drift-island-label">
                    {resource(type)}
                  </text>
                  {s.yields[i] !== null && (
                    <>
                      <circle cx={x} cy={y} r="20" fill="#f7f0e1" stroke="#182f43" />
                      <text x={x} y={y + 6} class="drift-yield">
                        {s.yields[i]}
                      </text>
                    </>
                  )}
                  {s.squall === i && (
                    <text x={x} y={y + 35} class="drift-squall" aria-label="Squall">
                      ☁
                    </text>
                  )}
                </g>
              );
            })}
            {BOARD.lanes.map((lane, i) => {
              const a = BOARD.sites[lane.a],
                b = BOARD.sites[lane.b];
              if (!a || !b) return null;
              const [x1, y1] = xy(a.x, a.y),
                [x2, y2] = xy(b.x, b.y);
              const action = actions.find((a) => a.type === 'link' && a.lane === i),
                owner = s.links[i];
              return (
                <MapTarget
                  key={i}
                  action={action}
                  active={active}
                  label={`Build sky link on lane ${i + 1}`}
                  submit={submit}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={owner === null ? '#f7f0e1' : color(owner ?? 0)}
                    stroke-width={owner === null ? 6 : 11}
                  />
                  {action && (
                    <rect
                      x={Math.min(x1, x2) - 12}
                      y={Math.min(y1, y2) - 12}
                      width={Math.abs(x2 - x1) + 24}
                      height={Math.abs(y2 - y1) + 24}
                      fill="transparent"
                    />
                  )}
                </MapTarget>
              );
            })}
            {BOARD.sites.map((site, i) => {
              const [x, y] = xy(site.x, site.y),
                b = s.buildings[i],
                action = actions.find((a) => (a.type === 'hearth' || a.type === 'hub') && a.site === i);
              return (
                <MapTarget
                  key={i}
                  action={action}
                  active={active}
                  label={`${action?.type === 'hub' ? 'Upgrade hub' : 'Build hearth'} at site ${i + 1}`}
                  submit={submit}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={b ? 13 : 5}
                    fill={b ? color(b.seat) : '#f7f0e1'}
                    stroke="#182f43"
                    stroke-width="2"
                  />
                  {b?.hub && <circle cx={x} cy={y} r="9" fill="none" stroke="#f7f0e1" stroke-width="2" />}
                  {b && (
                    <text x={x} y={y + 4} class="drift-seat-letter">
                      {String.fromCharCode(65 + b.seat)}
                    </text>
                  )}
                  {action && (
                    <circle
                      cx={x}
                      cy={y}
                      r="21"
                      fill="transparent"
                      stroke={active ? '#ac7a23' : 'transparent'}
                      stroke-dasharray="4 3"
                    />
                  )}
                </MapTarget>
              );
            })}
            {BOARD.moorings.map((m, i) => {
              const l = BOARD.lanes[m.lane],
                a = l ? BOARD.sites[l.a] : null,
                b = l ? BOARD.sites[l.b] : null;
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2,
                my = (a.y + b.y) / 2,
                d = Math.hypot(mx, my),
                [x, y] = xy(mx + (mx / d) * 0.45, my + (my / d) * 0.45);
              return (
                <g key={i} class="drift-mooring-marker">
                  <rect x={x - 37} y={y - 10} width="74" height="20" rx="4" fill="#f7f0e1" stroke="#ac7a23" />
                  <text x={x} y={y + 3} class="drift-mooring">
                    {m.resource === null ? '3:1' : `${resource(m.resource)} 2:1`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <aside class="drift-sidebar">
          <h3>Guilds</h3>
          {s.players.map((p, i) => {
            const score =
              s.buildings.reduce((n, b) => n + (b?.seat === i ? (b.hub ? 2 : 1) : 0), 0) +
              (s.span === i ? 2 : 0) +
              (s.watch === i ? 2 : 0);
            return (
              <article key={i} class="drift-player" style={{ borderLeftColor: color(i) }}>
                <strong>
                  {names[i] ?? `Player ${i + 1}`}
                  {i === s.turn ? ' · active' : ''}
                </strong>
                <p>
                  {score} public prestige · {p.count} supplies · {p.ventures.length} ventures · {p.guides}{' '}
                  Guides
                </p>
                {s.span === i && <p>Grand Span +2</p>}
                {s.watch === i && <p>Stormwatch +2</p>}
              </article>
            );
          })}
          <h3>Supply banks</h3>
          <GoodsList goods={s.bank} />
          <h3>Build costs</h3>
          <p>Link: Timber + Clay</p>
          <p>Hearth: Timber + Clay + Fiber + Grain</p>
          <p>Hub: 2 Grain + 3 Metal</p>
          <p>Venture: Fiber + Grain + Metal</p>
        </aside>
      </div>
      {mine?.goods && (
        <section class="drift-hand" data-testid="drift-hand">
          <h3>Your supplies</h3>
          <GoodsList goods={mine.goods} />
          <h3>Your ventures</h3>
          <div class="drift-ventures">
            {mine.ventures.map((v) => (
              <article key={v.pos} data-testid="drift-venture">
                <strong>
                  {v.card === null
                    ? 'Unseen venture'
                    : v.card >= 20
                      ? THEME.landmarks[v.card - 20]
                      : THEME.ventures[v.card < 14 ? 0 : v.card < 16 ? 1 : v.card < 18 ? 2 : 3]}
                </strong>
                {v.card !== null && v.card >= 20 && <p>1 hidden prestige</p>}
                {actions.filter((a) => a.type === 'play' && a.pos === v.pos).map(makeButton)}
              </article>
            ))}
          </div>
        </section>
      )}
      <section class="drift-decisions">
        <h3>Decision</h3>
        {!active && <p>{viewer === null ? 'Watching the table.' : 'Waiting for the current decision.'}</p>}
        <div class="drift-controls">
          {actions
            .filter((a) => !['hearth', 'hub', 'link', 'play', 'discard'].includes(a.type))
            .map(makeButton)}
        </div>
        {active && s.stage === 'discard' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit({ type: 'discard', actor: s.actor, goods: discard as unknown as Goods });
            }}
          >
            <p>Return {Math.floor((mine?.count ?? 0) / 2)} supplies.</p>
            <div class="drift-fields">{field(discard, setDiscard, 'Discard')}</div>
            <button
              type="submit"
              data-action={JSON.stringify({ type: 'discard', actor: s.actor, goods: discard })}
            >
              Discard selected supplies
            </button>
          </form>
        )}
        {active && s.stage === 'trade' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit({
                type: 'offer',
                actor: s.actor,
                to: partner,
                give: give as unknown as Goods,
                receive: receive as unknown as Goods,
              });
            }}
          >
            <h4>Offer supplies to a rival</h4>
            <label>
              Trading partner
              <select value={partner} onChange={(e) => setPartner(Number(e.currentTarget.value))}>
                <option value={s.actor}>Choose a rival</option>
                {s.players.map((_, i) =>
                  i === s.actor ? null : (
                    <option key={i} value={i}>
                      {names[i] ?? `Player ${i + 1}`}
                    </option>
                  ),
                )}
              </select>
            </label>
            <p>You give</p>
            <div class="drift-fields">{field(give, setGive, 'Give')}</div>
            <p>You receive</p>
            <div class="drift-fields">{field(receive, setReceive, 'Receive')}</div>
            <button type="submit" disabled={partner === s.actor}>
              Offer trade
            </button>
          </form>
        )}
        {s.offer && (
          <p>
            Offer from {names[s.offer.from]}: <GoodsList goods={s.offer.give} /> for{' '}
            <GoodsList goods={s.offer.receive} />
          </p>
        )}
        {active && ['setup-hearth', 'setup-link', 'free-links', 'construct'].includes(s.stage) && (
          <p>Select a marked site to build a hearth or hub, or a lane to build a link.</p>
        )}
      </section>
    </section>
  );
}
