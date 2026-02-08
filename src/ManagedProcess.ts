import { Effect } from 'effect';
import type { ProcessConfig, ProcessStatus } from './types.js';
import { ProcessPoolError } from './errors.js';

export interface ManagedProcess {
  readonly id: string;
  readonly config: ProcessConfig;
  readonly status: () => ProcessStatus;
  readonly interrupt: () => Effect.Effect<void, ProcessPoolError>;
  readonly kill: () => Effect.Effect<void, ProcessPoolError>;
}
