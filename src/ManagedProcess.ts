import { Effect } from 'effect';
import type { ChildProcess } from 'node:child_process';
import type { ProcessConfig, ProcessStatus } from './types.js';
import { ProcessPoolError } from './errors.js';

export interface ManagedProcess {
  readonly id: string;
  readonly config: ProcessConfig;
  readonly status: () => ProcessStatus;
  readonly interrupt: () => Effect.Effect<void, ProcessPoolError>;
  readonly kill: () => Effect.Effect<void, ProcessPoolError>;
}

export class ManagedProcessImpl implements ManagedProcess {
  private currentStatus: ProcessStatus = 'starting';

  constructor(
    public readonly id: string,
    public readonly config: ProcessConfig,
    private readonly childProcess: ChildProcess
  ) {
    // Listen to process events to update status
    this.childProcess.on('spawn', () => {
      this.currentStatus = 'running';
    });

    this.childProcess.on('exit', (code: number | null, signal: string | null) => {
      if (signal) {
        this.currentStatus = 'stopped';
      } else if (code !== 0) {
        this.currentStatus = 'error';
      } else {
        this.currentStatus = 'stopped';
      }
    });

    this.childProcess.on('error', () => {
      this.currentStatus = 'error';
    });

    // If process spawned immediately
    if (this.childProcess.pid) {
      this.currentStatus = 'running';
    }
  }

  status(): ProcessStatus {
    return this.currentStatus;
  }

  interrupt(): Effect.Effect<void, ProcessPoolError> {
    const self = this;
    return Effect.gen(function* () {
      try {
        if (self.childProcess.pid && !self.childProcess.killed) {
          self.currentStatus = 'stopping';
          self.childProcess.kill('SIGINT');
        }
      } catch (error) {
        return yield* Effect.fail(
          new ProcessPoolError({
            message: `Failed to interrupt process ${self.id}`,
            cause: error,
          })
        );
      }
    });
  }

  kill(): Effect.Effect<void, ProcessPoolError> {
    const self = this;
    return Effect.gen(function* () {
      try {
        if (self.childProcess.pid && !self.childProcess.killed) {
          self.currentStatus = 'stopping';
          self.childProcess.kill('SIGTERM');
        }
      } catch (error) {
        return yield* Effect.fail(
          new ProcessPoolError({
            message: `Failed to kill process ${self.id}`,
            cause: error,
          })
        );
      }
    });
  }
}
