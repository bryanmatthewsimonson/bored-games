/*
 * The preview harness (D086): renders one snapshot from `snapshots.json` with the game's real screen, as seat 0
 * sees it on their turn, for `previews.ts` to photograph. Never built into the site: `vite build` takes only
 * index.html. Open it as /scripts/previews/harness.html?i=<index>.
 */
import type { SessionView } from '@bored-games/client';
import { render } from 'preact';
// The site's styles first, as the app loads them, so each game's own sheet comes after.
import '../../src/styles.css';
import { Avatar } from '../../src/components/avatar.tsx';
import { type AppContext, AppCtx } from '../../src/context.ts';
import { webGame } from '../../src/games/registry.ts';
import { memoryStorage } from '../../src/storage.ts';

interface Snapshot {
  readonly game: string;
  readonly seats: number;
  readonly step: number;
  readonly state: unknown;
  readonly legal: readonly unknown[];
  readonly pending: SessionView['pending'];
  readonly events: SessionView['events'];
}

const NAMES = ['Sam', 'Ada', 'Bram', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gus', 'Hana', 'Ivo'];
const KEYS = NAMES.map((_, i) => ((i + 7) * 0x9e3779b1).toString(16).padStart(8, '0').repeat(8));

async function main(): Promise<void> {
  const index = Number(new URLSearchParams(location.search).get('i') ?? '0');
  const snapshots = (await (await fetch('./snapshots.json')).json()) as Snapshot[];
  const snap = snapshots[index];
  const game = snap === undefined ? undefined : webGame(snap.game);
  if (snap === undefined || game === undefined) throw new Error(`no snapshot ${index}`);
  const view = {
    phase: 'play',
    rootId: 'ab'.repeat(32),
    seats: snap.seats,
    mySeat: 0,
    head: { id: (snap.step + 4096).toString(16).padStart(64, '0'), seq: snap.step },
    state: snap.state,
    pending: snap.pending,
    outcome: null,
    events: snap.events,
    forfeits: [],
    resigned: [],
  } as unknown as SessionView;
  const names = NAMES.slice(0, snap.seats);
  const Component = game.Component;
  // Only what a game screen reads (Room for Doubt's notes keep their marks in the store).
  const app = { profile: 'preview', store: memoryStorage() } as unknown as AppContext;
  render(
    <AppCtx.Provider value={app}>
      <main id="main">
        <Component
          view={view}
          mySeat={0}
          legal={snap.legal}
          canAct={true}
          lockedReason=""
          busy={false}
          onAct={async () => {}}
          names={names}
          avatars={names.map((name, i) => <Avatar key={name} pubkey={KEYS[i] ?? ''} picture={null} />)}
          audit={undefined}
          notice={undefined}
          deadline="23h 41m left"
          onClaimTimeout={undefined}
          timeoutExplanation={undefined}
          ended={false}
        />
      </main>
    </AppCtx.Provider>,
    document.getElementById('app') as HTMLElement,
  );
  document.documentElement.dataset.ready = '1';
}

void main();
