import { useApp } from './context.ts';
import { LobbyController } from './lobby-controller.ts';
import type { ControllerDeps } from './net.ts';

const lobbies = new WeakMap<ControllerDeps, LobbyController>();

/**
 * The one LobbyController of the page, listening from the first screen that asks. It lives as long as the page,
 * so moving between Home and a Table shows what is already known at once.
 */
export function lobbyFor(deps: ControllerDeps): LobbyController {
  let c = lobbies.get(deps);
  if (c === undefined) {
    c = new LobbyController(deps);
    lobbies.set(deps, c);
  }
  c.listen();
  return c;
}

export function useLobby(): LobbyController {
  return lobbyFor(useApp().deps);
}
