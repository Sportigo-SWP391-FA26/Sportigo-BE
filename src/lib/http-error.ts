export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'HTTP_ERROR',
    public readonly details?: unknown,
  ) {
    super(message)
  }
}
