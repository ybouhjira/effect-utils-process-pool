import { Data } from 'effect';

export class ProcessPoolError extends Data.TaggedError('ProcessPoolError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ProcessLimitError extends Data.TaggedError('ProcessLimitError')<{
  readonly message: string;
  readonly maxConcurrent: number;
  readonly currentCount: number;
}> {}

export class ProcessNotFoundError extends Data.TaggedError('ProcessNotFoundError')<{
  readonly message: string;
  readonly processId: string;
}> {}
