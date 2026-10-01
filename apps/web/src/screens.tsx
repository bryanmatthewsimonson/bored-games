/*
 * Placeholder screens. Home, Table and Game are filled in by later tasks; the router and the shell around
 * them are final.
 */
import { BRAND } from '@bored-games/brand';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { npubEncode, shortNpub } from './bech32.ts';
import { homeHref, type Route } from './router.ts';

export function HomeScreen() {
  return (
    <section class="panel" aria-labelledby="home-title">
      <h1 id="home-title">{BRAND.tagline}</h1>
      <p>
        <strong>{CHAIN_REACTION_THEME.title}</strong>: {CHAIN_REACTION_THEME.tagline}
      </p>
      <p class="muted">The table list and the create-table form arrive in the next step.</p>
    </section>
  );
}

export function TableScreen(props: { creator: string; tableId: string }) {
  return (
    <section class="panel" aria-labelledby="table-title">
      <h1 id="table-title">Table</h1>
      <dl class="facts">
        <dt>Name</dt>
        <dd>{props.tableId}</dd>
        <dt>Created by</dt>
        <dd>
          <code>{shortNpub(npubEncode(props.creator))}</code>
        </dd>
      </dl>
      <p class="muted">The lobby arrives in the next step.</p>
    </section>
  );
}

export function GameScreen(props: { rootId: string }) {
  return (
    <section class="panel" aria-labelledby="game-title">
      <h1 id="game-title">Game</h1>
      <dl class="facts">
        <dt>Game id</dt>
        <dd>
          <code>{props.rootId.slice(0, 12)}…</code>
        </dd>
      </dl>
      <p class="muted">The board arrives in a later step.</p>
    </section>
  );
}

export function NotFoundScreen() {
  return (
    <section class="panel" aria-labelledby="nf-title">
      <h1 id="nf-title">Page not found</h1>
      <p>
        <a href={homeHref()}>Back to the start</a>
      </p>
    </section>
  );
}

export function Screen(props: { route: Route }) {
  const r = props.route;
  switch (r.name) {
    case 'home':
      return <HomeScreen />;
    case 'table':
      return <TableScreen creator={r.creator} tableId={r.tableId} />;
    case 'game':
      return <GameScreen rootId={r.rootId} />;
    case 'not-found':
      return <NotFoundScreen />;
  }
}
