import { Layer, Effect, Ref, HashMap } from 'effect';
import { spawn } from 'node:child_process';
import { ProcessPool } from './ProcessPool.js';
import { ManagedProcessImpl } from './ManagedProcess.js';
import type { PoolConfig, ProcessConfig } from './types.js';
import { ProcessLimitError, ProcessNotFoundError, ProcessPoolError } from './errors.js';

export const ProcessPoolLive = (config: PoolConfig): Layer.Layer<ProcessPool> =>
  Layer.effect(
    ProcessPool,
    Effect.gen(function* () {
      const processes = yield* Ref.make(HashMap.empty<string, ManagedProcessImpl>());

      return ProcessPool.of({
        spawn: (id: string, processConfig: ProcessConfig) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(processes);
            const currentSize = HashMap.size(current);

            if (currentSize >= config.maxConcurrent) {
              return yield* Effect.fail(
                new ProcessLimitError({
                  message: `Process pool limit reached. Max: ${config.maxConcurrent}, Current: ${currentSize}`,
                  maxConcurrent: config.maxConcurrent,
                  currentCount: currentSize,
                })
              );
            }

            try {
              // Spawn child process
              const child = spawn(
                processConfig.command,
                processConfig.args ?? [],
                {
                  cwd: processConfig.cwd,
                  env: processConfig.env
                    ? { ...globalThis.process.env, ...processConfig.env }
                    : undefined,
                }
              );

              const managed = new ManagedProcessImpl(id, processConfig, child);

              // Auto-cleanup on exit
              child.on('exit', () => {
                Effect.runSync(Ref.update(processes, HashMap.remove(id)));
              });

              // Add to pool
              yield* Ref.update(processes, HashMap.set(id, managed));

              return managed;
            } catch (error) {
              return yield* Effect.fail(
                new ProcessPoolError({
                  message: `Failed to spawn process ${id}`,
                  cause: error,
                })
              );
            }
          }),

        get: (id: string) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(processes);
            const maybeProcess = HashMap.get(current, id);

            if (maybeProcess._tag === 'None') {
              return yield* Effect.fail(
                new ProcessNotFoundError({
                  message: `Process not found: ${id}`,
                  processId: id,
                })
              );
            }

            return maybeProcess.value;
          }),

        kill: (id: string) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(processes);
            const maybeProcess = HashMap.get(current, id);

            if (maybeProcess._tag === 'None') {
              return yield* Effect.fail(
                new ProcessNotFoundError({
                  message: `Process not found: ${id}`,
                  processId: id,
                })
              );
            }

            const managed = maybeProcess.value;

            // Kill the process
            yield* managed.kill();

            // Remove from pool immediately
            yield* Ref.update(processes, HashMap.remove(id));
          }),

        interrupt: (id: string) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(processes);
            const maybeProcess = HashMap.get(current, id);

            if (maybeProcess._tag === 'None') {
              return yield* Effect.fail(
                new ProcessNotFoundError({
                  message: `Process not found: ${id}`,
                  processId: id,
                })
              );
            }

            const managed = maybeProcess.value;

            // Interrupt the process
            yield* managed.interrupt();

            // Remove from pool immediately
            yield* Ref.update(processes, HashMap.remove(id));
          }),

        killAll: () =>
          Effect.gen(function* () {
            const current = yield* Ref.get(processes);
            const allProcesses = Array.from(HashMap.values(current));

            // Kill all processes
            for (const managed of allProcesses) {
              yield* managed.kill();
            }

            // Clear the pool
            yield* Ref.set(processes, HashMap.empty());
          }),

        size: () =>
          Effect.gen(function* () {
            const current = yield* Ref.get(processes);
            return HashMap.size(current);
          }),

        has: (id: string) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(processes);
            const maybeProcess = HashMap.get(current, id);
            return maybeProcess._tag === 'Some';
          }),
      });
    })
  );
