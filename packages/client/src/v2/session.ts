import { ClientError } from '../errors.ts';
import type { Session } from '../session-api.ts';
import type { SessionInput } from '../types.ts';

/*
 * GameSessionV2: the protocol 2 fold (PROTOCOL-v2), built from task T7 of the v2 build plan on. Until then a
 * proto-2 root reaches this class through `openSession` and is refused here, never folded by v1 rules.
 */
export class GameSessionV2 {
  readonly proto = 2 as const;

  private constructor() {}

  /** Not built yet: always throws `ClientError`. */
  static create(_input: SessionInput): Session {
    throw new ClientError('the protocol 2 session is not built yet');
  }
}
