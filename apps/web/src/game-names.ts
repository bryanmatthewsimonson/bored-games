import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';

/** The player-facing title of a game module id. Unknown ids are shown as they are. */
export function gameTitle(moduleId: string): string {
  return moduleId === 'chain-reaction' ? CHAIN_REACTION_THEME.title : moduleId;
}
