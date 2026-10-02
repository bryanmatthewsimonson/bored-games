/* Screens by route. Each real screen lives in screens/. */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { webGame } from './games/registry.ts';
import { homeHref, type Route } from './router.ts';
import { CreditsScreen } from './screens/credits.tsx';
import { GameScreen } from './screens/game.tsx';
import { HomeScreen } from './screens/home.tsx';
import { TableScreen } from './screens/table.tsx';

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
    case 'rules': {
      const game = webGame(r.game);
      return game === undefined ? <NotFoundScreen /> : <game.RulesPage section={r.section} />;
    }
    case 'credits':
      return <CreditsScreen />;
    case 'dev':
      return import.meta.env.DEV ? <DevScreen page={r.page} scene={r.scene} /> : <NotFoundScreen />;
    case 'not-found':
      return <NotFoundScreen />;
  }
}
