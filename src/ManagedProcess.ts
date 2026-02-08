import { Effect, Stream } from 'effect';
import type { ChildProcess } from 'node:child_process';
import type { ProcessConfig, ProcessStatus } from './types.js';
import { ProcessPoolError } from './errors.js';

export interface ManagedProcess {
  readonly id: string;
  readonly config: ProcessConfig;
  readonly status: () => ProcessStatus;
  readonly interrupt: () => Effect.Effect<void, ProcessPoolError>;
  readonly kill: () => Effect.Effect<void, ProcessPoolError>;
  readonly stdout: Stream.Stream<string, ProcessPoolError>;
  readonly stderr: Stream.Stream<string, ProcessPoolError>;
  readonly write: (data: string) => Effect.Effect<void, ProcessPoolError>;
}

export class ManagedProcessImpl implements ManagedProcess {
  private currentStatus: ProcessStatus = 'starting';
  readonly stdout: Stream.Stream<string, ProcessPoolError>;
  readonly stderr: Stream.Stream<string, ProcessPoolError>;

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

    // Create stdout stream
    this.stdout = this.createReadableStream(this.childProcess.stdout);

    // Create stderr stream
    this.stderr = this.createReadableStream(this.childProcess.stderr);
  }

  private createReadableStream(
    readable: import('node:stream').Readable | null
  ): Stream.Stream<string, ProcessPoolError> {
    /* v8 ignore next 3 - Defensive check, unreachable with stdio: ['pipe', 'pipe', 'pipe'] */
    if (!readable) {
      return Stream.empty;
    }

    const self = this;
    return Stream.asyncScoped<string, ProcessPoolError>((emit) =>
      Effect.gen(function* () {
        const onData = (chunk: Buffer) => {
          emit.single(chunk.toString('utf-8'));
        };

        const onEnd = () => {
          emit.end();
        };

        /* v8 ignore next 8 - Stream errors are rare, hard to trigger without mocking */
        const onError = (err: Error) => {
          emit.fail(
            new ProcessPoolError({
              message: `Stream error on process ${self.id}`,
              cause: err,
            })
          );
        };

        readable.on('data', onData);
        readable.on('end', onEnd);
        readable.on('error', onError);

        // Cleanup function
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            readable.off('data', onData);
            readable.off('end', onEnd);
            readable.off('error', onError);
          })
        );
      })
    );
  }

  status(): ProcessStatus {
    return this.currentStatus;
  }

  interrupt(): Effect.Effect<void, ProcessPoolError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.childProcess.pid && !self.childProcess.killed) {
        self.currentStatus = 'stopping';
        self.childProcess.kill('SIGINT');
        // Note: kill() returns false if process already dead, but that's OK (no-op)
      }
    });
  }

  kill(): Effect.Effect<void, ProcessPoolError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.childProcess.pid && !self.childProcess.killed) {
        self.currentStatus = 'stopping';
        self.childProcess.kill('SIGTERM');
        // Note: kill() returns false if process already dead, but that's OK (no-op)
      }
    });
  }

  write(data: string): Effect.Effect<void, ProcessPoolError> {
    const self = this;
    return Effect.gen(function* () {
      /* v8 ignore next 7 - Defensive check, unreachable with stdio: ['pipe', 'pipe', 'pipe'] */
      if (!self.childProcess.stdin) {
        return yield* Effect.fail(
          new ProcessPoolError({
            message: `No stdin available for process ${self.id}`,
          })
        );
      }

      if (self.childProcess.killed || !self.childProcess.pid) {
        return yield* Effect.fail(
          new ProcessPoolError({
            message: `Cannot write to dead process ${self.id}`,
          })
        );
      }

      yield* Effect.async<void, ProcessPoolError>((resume) => {
        self.childProcess.stdin!.write(data, (err) => {
          if (err) {
            resume(
              Effect.fail(
                new ProcessPoolError({
                  message: `Failed to write to process ${self.id}`,
                  cause: err,
                })
              )
            );
          } else {
            resume(Effect.succeed(undefined));
          }
        });
      });
    });
  }
}
