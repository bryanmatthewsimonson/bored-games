/**
 * The one error the client throws, for caller errors only: an invalid game start handed to `GameSession.create`,
 * or a `build…` call for a duty that is not this seat's. Peer input never throws; `receive` reports it instead.
 */
export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}
