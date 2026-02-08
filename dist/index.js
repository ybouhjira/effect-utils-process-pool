import { Data, Context, Stream, Effect, Layer, Ref, HashMap, Schedule, Duration } from 'effect';
import { spawn } from 'child_process';

// src/errors.ts
var ProcessPoolError = class extends Data.TaggedError("ProcessPoolError") {
};
var ProcessLimitError = class extends Data.TaggedError("ProcessLimitError") {
};
var ProcessNotFoundError = class extends Data.TaggedError("ProcessNotFoundError") {
};
var ProcessPool = class extends Context.Tag("ProcessPool")() {
};
var ManagedProcessImpl = class {
  constructor(id, config, childProcess) {
    this.id = id;
    this.config = config;
    this.childProcess = childProcess;
    this.childProcess.on("spawn", () => {
      this.currentStatus = "running";
    });
    this.childProcess.on("exit", (code, signal) => {
      if (signal) {
        this.currentStatus = "stopped";
      } else if (code !== 0) {
        this.currentStatus = "error";
      } else {
        this.currentStatus = "stopped";
      }
    });
    this.childProcess.on("error", () => {
      this.currentStatus = "error";
    });
    if (this.childProcess.pid) {
      this.currentStatus = "running";
    }
    this.stdout = this.createReadableStream(this.childProcess.stdout);
    this.stderr = this.createReadableStream(this.childProcess.stderr);
  }
  currentStatus = "starting";
  stdout;
  stderr;
  createReadableStream(readable) {
    if (!readable) {
      return Stream.empty;
    }
    const self = this;
    return Stream.asyncScoped(
      (emit) => Effect.gen(function* () {
        const onData = (chunk) => {
          emit.single(chunk.toString("utf-8"));
        };
        const onEnd = () => {
          emit.end();
        };
        const onError = (err) => {
          emit.fail(
            new ProcessPoolError({
              message: `Stream error on process ${self.id}`,
              cause: err
            })
          );
        };
        readable.on("data", onData);
        readable.on("end", onEnd);
        readable.on("error", onError);
        yield* Effect.addFinalizer(
          () => Effect.sync(() => {
            readable.off("data", onData);
            readable.off("end", onEnd);
            readable.off("error", onError);
          })
        );
      })
    );
  }
  status() {
    return this.currentStatus;
  }
  interrupt() {
    const self = this;
    return Effect.gen(function* () {
      if (self.childProcess.pid && !self.childProcess.killed) {
        self.currentStatus = "stopping";
        self.childProcess.kill("SIGINT");
      }
    });
  }
  kill() {
    const self = this;
    return Effect.gen(function* () {
      if (self.childProcess.pid && !self.childProcess.killed) {
        self.currentStatus = "stopping";
        self.childProcess.kill("SIGTERM");
      }
    });
  }
  write(data) {
    const self = this;
    return Effect.gen(function* () {
      if (!self.childProcess.stdin) {
        return yield* Effect.fail(
          new ProcessPoolError({
            message: `No stdin available for process ${self.id}`
          })
        );
      }
      if (self.childProcess.killed || !self.childProcess.pid) {
        return yield* Effect.fail(
          new ProcessPoolError({
            message: `Cannot write to dead process ${self.id}`
          })
        );
      }
      yield* Effect.async((resume) => {
        self.childProcess.stdin.write(data, (err) => {
          if (err) {
            resume(
              Effect.fail(
                new ProcessPoolError({
                  message: `Failed to write to process ${self.id}`,
                  cause: err
                })
              )
            );
          } else {
            resume(Effect.succeed(void 0));
          }
        });
      });
    });
  }
};
var ProcessPoolLive = (config) => Layer.scoped(
  ProcessPool,
  Effect.gen(function* () {
    const processes = yield* Ref.make(HashMap.empty());
    const killAllProcesses = Effect.gen(function* () {
      const current = yield* Ref.get(processes);
      const allProcesses = Array.from(HashMap.values(current));
      for (const managed of allProcesses) {
        yield* managed.kill();
      }
      yield* Ref.set(processes, HashMap.empty());
    });
    yield* Effect.addFinalizer(
      () => killAllProcesses.pipe(Effect.catchAll(() => Effect.void))
    );
    if (config.healthCheckInterval) {
      const healthCheck = Effect.gen(function* () {
        const current = yield* Ref.get(processes);
        const entries = Array.from(HashMap.entries(current));
        for (const [id, managed] of entries) {
          const status = managed.status();
          if (status === "stopped" || status === "error") {
            yield* Ref.update(processes, HashMap.remove(id));
          }
        }
      });
      const scheduled = healthCheck.pipe(
        Effect.schedule(Schedule.spaced(Duration.decode(config.healthCheckInterval)))
      );
      yield* Effect.forkDaemon(scheduled);
    }
    return ProcessPool.of({
      spawn: (id, processConfig) => Effect.gen(function* () {
        const current = yield* Ref.get(processes);
        const currentSize = HashMap.size(current);
        if (currentSize >= config.maxConcurrent) {
          return yield* Effect.fail(
            new ProcessLimitError({
              message: `Process pool limit reached. Max: ${config.maxConcurrent}, Current: ${currentSize}`,
              maxConcurrent: config.maxConcurrent,
              currentCount: currentSize
            })
          );
        }
        const child = spawn(
          processConfig.command,
          processConfig.args ?? [],
          {
            cwd: processConfig.cwd,
            env: processConfig.env ? { ...globalThis.process.env, ...processConfig.env } : void 0,
            stdio: ["pipe", "pipe", "pipe"]
          }
        );
        const managed = new ManagedProcessImpl(id, processConfig, child);
        yield* Effect.async((resume) => {
          if (child.pid) {
            resume(Effect.succeed(void 0));
            return;
          }
          child.once("spawn", () => {
            resume(Effect.succeed(void 0));
          });
          child.once("error", (err) => {
            resume(Effect.fail(new ProcessPoolError({
              message: `Failed to spawn process ${id}: ${err.message}`,
              cause: err
            })));
          });
        });
        child.on("exit", () => {
          Effect.runSync(Ref.update(processes, HashMap.remove(id)));
        });
        yield* Ref.update(processes, HashMap.set(id, managed));
        return managed;
      }),
      get: (id) => Effect.gen(function* () {
        const current = yield* Ref.get(processes);
        const maybeProcess = HashMap.get(current, id);
        if (maybeProcess._tag === "None") {
          return yield* Effect.fail(
            new ProcessNotFoundError({
              message: `Process not found: ${id}`,
              processId: id
            })
          );
        }
        return maybeProcess.value;
      }),
      kill: (id) => Effect.gen(function* () {
        const current = yield* Ref.get(processes);
        const maybeProcess = HashMap.get(current, id);
        if (maybeProcess._tag === "None") {
          return yield* Effect.fail(
            new ProcessNotFoundError({
              message: `Process not found: ${id}`,
              processId: id
            })
          );
        }
        const managed = maybeProcess.value;
        yield* managed.kill();
        yield* Ref.update(processes, HashMap.remove(id));
      }),
      interrupt: (id) => Effect.gen(function* () {
        const current = yield* Ref.get(processes);
        const maybeProcess = HashMap.get(current, id);
        if (maybeProcess._tag === "None") {
          return yield* Effect.fail(
            new ProcessNotFoundError({
              message: `Process not found: ${id}`,
              processId: id
            })
          );
        }
        const managed = maybeProcess.value;
        yield* managed.interrupt();
        yield* Ref.update(processes, HashMap.remove(id));
      }),
      killAll: () => killAllProcesses,
      size: () => Effect.gen(function* () {
        const current = yield* Ref.get(processes);
        return HashMap.size(current);
      }),
      has: (id) => Effect.gen(function* () {
        const current = yield* Ref.get(processes);
        const maybeProcess = HashMap.get(current, id);
        return maybeProcess._tag === "Some";
      })
    });
  })
);

export { ManagedProcessImpl, ProcessLimitError, ProcessNotFoundError, ProcessPool, ProcessPoolError, ProcessPoolLive };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map