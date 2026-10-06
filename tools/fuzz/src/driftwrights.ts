import type { Action, NetworkState } from '@bored-games/driftwrights';
import type { FuzzPolicy } from '@bored-games/game-kit';
import { chooseForTest } from '../../../packages/games/driftwrights/src/choices.ts';
export const DRIFTWRIGHTS_POLICIES: readonly FuzzPolicy<NetworkState>[] = [
  {
    name: 'haven-builder',
    choose: (s, _seat, actions) => {
      const first = actions[0] as { type: string };
      return ['declare', 'contribute', 'requisition-payment', 'transfer'].includes(first.type)
        ? first
        : chooseForTest(s, actions as Action[]);
    },
  },
];
