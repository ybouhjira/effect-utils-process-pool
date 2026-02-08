import type { Duration } from 'effect';

export interface PoolConfig {
  readonly maxConcurrent: number;
  readonly idleTimeout?: Duration.DurationInput;
  readonly healthCheckInterval?: Duration.DurationInput;
}

export interface ProcessConfig {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export type ProcessStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'stopped' | 'error';
