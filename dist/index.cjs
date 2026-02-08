'use strict';

var effect = require('effect');
var child_process = require('child_process');

// src/errors.ts
var ProcessPoolError = class extends effect.Data.TaggedError("ProcessPoolError") {
};
var ProcessLimitError = class extends effect.Data.TaggedError("ProcessLimitError") {
};
var ProcessNotFoundError = class extends effect.Data.TaggedError("ProcessNotFoundError") {
};
var ProcessPool = class extends effect.Context.Tag("ProcessPool")() {
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
      return effect.Stream.empty;
    }
    const self = this;
    return effect.Stream.asyncScoped(
      (emit) => effect.Effect.gen(function* () {
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
        yield* effect.Effect.addFinalizer(
          () => effect.Effect.sync(() => {
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
    return effect.Effect.gen(function* () {
      if (self.childProcess.pid && !self.childProcess.killed) {
        self.currentStatus = "stopping";
        self.childProcess.kill("SIGINT");
      }
    });
  }
  kill() {
    const self = this;
    return effect.Effect.gen(function* () {
      if (self.childProcess.pid && !self.childProcess.killed) {
        self.currentStatus = "stopping";
        self.childProcess.kill("SIGTERM");
      }
    });
  }
  write(data) {
    const self = this;
    return effect.Effect.gen(function* () {
      if (!self.childProcess.stdin) {
        return yield* effect.Effect.fail(
          new ProcessPoolError({
            message: `No stdin available for process ${self.id}`
          })
        );
      }
      if (self.childProcess.killed || !self.childProcess.pid) {
        return yield* effect.Effect.fail(
          new ProcessPoolError({
            message: `Cannot write to dead process ${self.id}`
          })
        );
      }
      yield* effect.Effect.async((resume) => {
        self.childProcess.stdin.write(data, (err) => {
          if (err) {
            resume(
              effect.Effect.fail(
                new ProcessPoolError({
                  message: `Failed to write to process ${self.id}`,
                  cause: err
                })
              )
            );
          } else {
            resume(effect.Effect.succeed(void 0));
          }
        });
      });
    });
  }
};
var ProcessPoolLive = (config) => effect.Layer.scoped(
  ProcessPool,
  effect.Effect.gen(function* () {
    const processes = yield* effect.Ref.make(effect.HashMap.empty());
    const killAllProcesses = effect.Effect.gen(function* () {
      const current = yield* effect.Ref.get(processes);
      const allProcesses = Array.from(effect.HashMap.values(current));
      for (const managed of allProcesses) {
        yield* managed.kill();
      }
      yield* effect.Ref.set(processes, effect.HashMap.empty());
    });
    yield* effect.Effect.addFinalizer(
      () => killAllProcesses.pipe(effect.Effect.catchAll(() => effect.Effect.void))
    );
    if (config.healthCheckInterval) {
      const healthCheck = effect.Effect.gen(function* () {
        const current = yield* effect.Ref.get(processes);
        const entries = Array.from(effect.HashMap.entries(current));
        for (const [id, managed] of entries) {
          const status = managed.status();
          if (status === "stopped" || status === "error") {
            yield* effect.Ref.update(processes, effect.HashMap.remove(id));
          }
        }
      });
      const scheduled = healthCheck.pipe(
        effect.Effect.schedule(effect.Schedule.spaced(effect.Duration.decode(config.healthCheckInterval)))
      );
      yield* effect.Effect.forkDaemon(scheduled);
    }
    return ProcessPool.of({
      spawn: (id, processConfig) => effect.Effect.gen(function* () {
        const current = yield* effect.Ref.get(processes);
        const currentSize = effect.HashMap.size(current);
        if (currentSize >= config.maxConcurrent) {
          return yield* effect.Effect.fail(
            new ProcessLimitError({
              message: `Process pool limit reached. Max: ${config.maxConcurrent}, Current: ${currentSize}`,
              maxConcurrent: config.maxConcurrent,
              currentCount: currentSize
            })
          );
        }
        const child = child_process.spawn(
          processConfig.command,
          processConfig.args ?? [],
          {
            cwd: processConfig.cwd,
            env: processConfig.env ? { ...globalThis.process.env, ...processConfig.env } : void 0,
            stdio: ["pipe", "pipe", "pipe"]
          }
        );
        const managed = new ManagedProcessImpl(id, processConfig, child);
        yield* effect.Effect.async((resume) => {
          if (child.pid) {
            resume(effect.Effect.succeed(void 0));
            return;
          }
          child.once("spawn", () => {
            resume(effect.Effect.succeed(void 0));
          });
          child.once("error", (err) => {
            resume(effect.Effect.fail(new ProcessPoolError({
              message: `Failed to spawn process ${id}: ${err.message}`,
              cause: err
            })));
          });
        });
        child.on("exit", () => {
          effect.Effect.runSync(effect.Ref.update(processes, effect.HashMap.remove(id)));
        });
        yield* effect.Ref.update(processes, effect.HashMap.set(id, managed));
        return managed;
      }),
      get: (id) => effect.Effect.gen(function* () {
        const current = yield* effect.Ref.get(processes);
        const maybeProcess = effect.HashMap.get(current, id);
        if (maybeProcess._tag === "None") {
          return yield* effect.Effect.fail(
            new ProcessNotFoundError({
              message: `Process not found: ${id}`,
              processId: id
            })
          );
        }
        return maybeProcess.value;
      }),
      kill: (id) => effect.Effect.gen(function* () {
        const current = yield* effect.Ref.get(processes);
        const maybeProcess = effect.HashMap.get(current, id);
        if (maybeProcess._tag === "None") {
          return yield* effect.Effect.fail(
            new ProcessNotFoundError({
              message: `Process not found: ${id}`,
              processId: id
            })
          );
        }
        const managed = maybeProcess.value;
        yield* managed.kill();
        yield* effect.Ref.update(processes, effect.HashMap.remove(id));
      }),
      interrupt: (id) => effect.Effect.gen(function* () {
        const current = yield* effect.Ref.get(processes);
        const maybeProcess = effect.HashMap.get(current, id);
        if (maybeProcess._tag === "None") {
          return yield* effect.Effect.fail(
            new ProcessNotFoundError({
              message: `Process not found: ${id}`,
              processId: id
            })
          );
        }
        const managed = maybeProcess.value;
        yield* managed.interrupt();
        yield* effect.Ref.update(processes, effect.HashMap.remove(id));
      }),
      killAll: () => killAllProcesses,
      size: () => effect.Effect.gen(function* () {
        const current = yield* effect.Ref.get(processes);
        return effect.HashMap.size(current);
      }),
      has: (id) => effect.Effect.gen(function* () {
        const current = yield* effect.Ref.get(processes);
        const maybeProcess = effect.HashMap.get(current, id);
        return maybeProcess._tag === "Some";
      })
    });
  })
);

exports.ManagedProcessImpl = ManagedProcessImpl;
exports.ProcessLimitError = ProcessLimitError;
exports.ProcessNotFoundError = ProcessNotFoundError;
exports.ProcessPool = ProcessPool;
exports.ProcessPoolError = ProcessPoolError;
exports.ProcessPoolLive = ProcessPoolLive;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map