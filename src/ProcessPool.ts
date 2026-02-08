import { Context, Effect } from 'effect';
import type { ProcessConfig } from './types.js';
import type { ManagedProcess } from './ManagedProcess.js';
import { ProcessPoolError, ProcessLimitError, ProcessNotFoundError } from './errors.js';

export interface ProcessPoolInterface {
  readonly spawn: (
    id: string,
    config: ProcessConfig
  ) => Effect.Effect<ManagedProcess, ProcessPoolError | ProcessLimitError>;

  readonly get: (id: string) => Effect.Effect<ManagedProcess, ProcessNotFoundError>;

  readonly kill: (id: string) => Effect.Effect<void, ProcessNotFoundError | ProcessPoolError>;

  readonly interrupt: (id: string) => Effect.Effect<void, ProcessNotFoundError | ProcessPoolError>;

  readonly killAll: () => Effect.Effect<void, ProcessPoolError>;

  readonly size: () => Effect.Effect<number>;

  readonly has: (id: string) => Effect.Effect<boolean>;
}

export class ProcessPool extends Context.Tag('ProcessPool')<ProcessPool, ProcessPoolInterface>() {}
