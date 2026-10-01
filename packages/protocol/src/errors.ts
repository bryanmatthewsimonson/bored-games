/** The one error type protocol parsers throw, on any malformed input: a stable machine `code` plus a message. */
export class ProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}
