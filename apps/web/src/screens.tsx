/*
 * Screens by route. Home and Table are placeholders filled in by a later task; the Game screen lives in
 * screens/game.tsx.
 */
import { BRAND } from '@bored-games/brand';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { npubEncode, shortNpub } from './bech32.ts';
import { homeHref, type Route } from './router.ts';
import { GameScreen } from './screens/game.tsx';

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

/** Dev-only previews, loaded on demand so that production builds leave them out. */
function DevScreen(props: { page: string; scene: string | null }) {
  const [Preview, setPreview] = useState<ComponentType<{ scene: string }> | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV || props.page !== 'board') return;
    import('./dev/board-preview.tsx').then((m) => setPreview(() => m.BoardPreview));
  }, [props.page]);
  if (props.page !== 'board') return <NotFoundScreen />;
  return Preview ? <Preview scene={props.scene ?? 'mid'} /> : <p class="muted">Loading the preview…</p>;
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
    case 'dev':
      return import.meta.env.DEV ? <DevScreen page={r.page} scene={r.scene} /> : <NotFoundScreen />;
    case 'not-found':
      return <NotFoundScreen />;
  }
}
