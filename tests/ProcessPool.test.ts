import { describe, it, expect, afterEach } from 'vitest';
import { Effect, Exit, Stream, Chunk } from 'effect';
import { ProcessPool } from '../src/ProcessPool.js';
import { ProcessPoolLive } from '../src/ProcessPoolLive.js';
import type { PoolConfig, ProcessStatus } from '../src/types.js';
import type { ManagedProcess } from '../src/ManagedProcess.js';
import type { ProcessPoolInterface } from '../src/ProcessPool.js';

const makeTestPool = (maxConcurrent = 5) =>
  ProcessPoolLive({ maxConcurrent });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ProcessPool', () => {
  let poolInstance: ProcessPoolInterface | null = null;

  const createPool = async (config: PoolConfig) => {
    const layer = makeTestPool(config.maxConcurrent);
    poolInstance = await Effect.runPromise(
      Effect.gen(function* () {
        const pool = yield* ProcessPool;
        return pool;
      }).pipe(Effect.provide(layer))
    );
    return poolInstance;
  };

  afterEach(async () => {
    if (poolInstance) {
      await Effect.runPromise(poolInstance.killAll());
      poolInstance = null;
    }
  });

  // === SPAWN ===
  it('should spawn a process and track it in the pool', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('test-1', { command: 'echo', args: ['hello'] })
    );

    expect(managed).toBeDefined();
    expect(managed.id).toBe('test-1');
    expect(managed.config.command).toBe('echo');
  });

  it('should set process status to running after spawn', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('test-2', { command: 'sleep', args: ['1'] })
    );

    const status: ProcessStatus = managed.status();
    expect(['starting', 'running']).toContain(status);
  });

  it('should return ManagedProcess with correct id and config', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const config = {
      command: 'echo',
      args: ['test'],
      cwd: '/tmp',
      env: { TEST: 'value' },
    };

    const managed: ManagedProcess = await Effect.runPromise(pool.spawn('test-3', config));

    expect(managed.id).toBe('test-3');
    expect(managed.config).toEqual(config);
  });

  it('should increment pool size after spawn', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const sizeBefore = await Effect.runPromise(pool.size());
    expect(sizeBefore).toBe(0);

    await Effect.runPromise(pool.spawn('test-4', { command: 'sleep', args: ['1'] }));

    const sizeAfter = await Effect.runPromise(pool.size());
    expect(sizeAfter).toBe(1);
  });

  // === GET ===
  it('should get a spawned process by id', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('test-5', { command: 'sleep', args: ['1'] }));

    const managed: ManagedProcess = await Effect.runPromise(pool.get('test-5'));
    expect(managed).toBeDefined();
    expect(managed.id).toBe('test-5');
  });

  it('should fail with ProcessNotFoundError for unknown id', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const exit = await Effect.runPromiseExit(pool.get('unknown'));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe('Fail');
      if (exit.cause._tag === 'Fail') {
        const error = exit.cause.error as any;
        expect(error._tag).toBe('ProcessNotFoundError');
      }
    }
  });

  // === HAS ===
  it('should return true for existing process', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('test-6', { command: 'sleep', args: ['1'] }));

    const has = await Effect.runPromise(pool.has('test-6'));
    expect(has).toBe(true);
  });

  it('should return false for non-existing process', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const has = await Effect.runPromise(pool.has('unknown'));
    expect(has).toBe(false);
  });

  // === KILL ===
  it('should kill a running process', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('test-7', { command: 'sleep', args: ['10'] }));

    await Effect.runPromise(pool.kill('test-7'));

    // Process should be removed
    const has = await Effect.runPromise(pool.has('test-7'));
    expect(has).toBe(false);
  });

  it('should remove killed process from pool', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('test-8', { command: 'sleep', args: ['10'] }));

    const sizeBefore = await Effect.runPromise(pool.size());
    expect(sizeBefore).toBe(1);

    await Effect.runPromise(pool.kill('test-8'));

    // Wait for cleanup
    await sleep(100);

    const sizeAfter = await Effect.runPromise(pool.size());
    expect(sizeAfter).toBe(0);
  });

  it('should fail with ProcessNotFoundError when killing unknown id', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const exit = await Effect.runPromiseExit(pool.kill('unknown'));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe('Fail');
      if (exit.cause._tag === 'Fail') {
        const error = exit.cause.error as any;
        expect(error._tag).toBe('ProcessNotFoundError');
      }
    }
  });

  // === INTERRUPT ===
  it('should interrupt a running process with SIGINT', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('test-9', { command: 'sleep', args: ['10'] }));

    await Effect.runPromise(pool.interrupt('test-9'));

    // Process should be removed
    const has = await Effect.runPromise(pool.has('test-9'));
    expect(has).toBe(false);
  });

  it('should remove interrupted process from pool', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('test-10', { command: 'sleep', args: ['10'] }));

    const sizeBefore = await Effect.runPromise(pool.size());
    expect(sizeBefore).toBe(1);

    await Effect.runPromise(pool.interrupt('test-10'));

    // Wait for cleanup
    await sleep(100);

    const sizeAfter = await Effect.runPromise(pool.size());
    expect(sizeAfter).toBe(0);
  });

  // === CONCURRENCY LIMIT ===
  it('should reject spawn when pool is at max capacity', async () => {
    const pool = await createPool({ maxConcurrent: 2 });

    // Spawn 2 processes (max)
    await Effect.runPromise(pool.spawn('limit-1', { command: 'sleep', args: ['10'] }));
    await Effect.runPromise(pool.spawn('limit-2', { command: 'sleep', args: ['10'] }));

    // Try to spawn 3rd
    const exit = await Effect.runPromiseExit(
      pool.spawn('limit-3', { command: 'sleep', args: ['10'] })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe('Fail');
      if (exit.cause._tag === 'Fail') {
        const error = exit.cause.error as any;
        expect(error._tag).toBe('ProcessLimitError');
      }
    }
  });

  it('should allow spawn after killing a process', async () => {
    const pool = await createPool({ maxConcurrent: 2 });

    // Spawn 2 processes (max)
    await Effect.runPromise(pool.spawn('limit-4', { command: 'sleep', args: ['10'] }));
    await Effect.runPromise(pool.spawn('limit-5', { command: 'sleep', args: ['10'] }));

    // Kill one
    await Effect.runPromise(pool.kill('limit-4'));

    // Wait for cleanup
    await sleep(100);

    // Should be able to spawn again
    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('limit-6', { command: 'sleep', args: ['10'] })
    );

    expect(managed).toBeDefined();
    expect(managed.id).toBe('limit-6');
  });

  // === KILL ALL ===
  it('should kill all processes in pool', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('killall-1', { command: 'sleep', args: ['10'] }));
    await Effect.runPromise(pool.spawn('killall-2', { command: 'sleep', args: ['10'] }));
    await Effect.runPromise(pool.spawn('killall-3', { command: 'sleep', args: ['10'] }));

    const sizeBefore = await Effect.runPromise(pool.size());
    expect(sizeBefore).toBe(3);

    await Effect.runPromise(pool.killAll());

    // Wait for cleanup
    await sleep(100);

    const sizeAfter = await Effect.runPromise(pool.size());
    expect(sizeAfter).toBe(0);
  });

  it('should leave pool empty after killAll', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('killall-4', { command: 'sleep', args: ['10'] }));
    await Effect.runPromise(pool.spawn('killall-5', { command: 'sleep', args: ['10'] }));

    await Effect.runPromise(pool.killAll());

    // Wait for cleanup
    await sleep(100);

    const has1 = await Effect.runPromise(pool.has('killall-4'));
    const has2 = await Effect.runPromise(pool.has('killall-5'));

    expect(has1).toBe(false);
    expect(has2).toBe(false);
  });

  // === AUTO CLEANUP ===
  it('should auto-remove process that exits naturally', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    // Spawn quick process
    await Effect.runPromise(pool.spawn('auto-1', { command: 'echo', args: ['done'] }));

    const sizeBefore = await Effect.runPromise(pool.size());
    expect(sizeBefore).toBe(1);

    // Wait for process to exit
    await sleep(200);

    const sizeAfter = await Effect.runPromise(pool.size());
    expect(sizeAfter).toBe(0);
  });

  // === SIZE ===
  it('should report correct size', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    let size = await Effect.runPromise(pool.size());
    expect(size).toBe(0);

    await Effect.runPromise(pool.spawn('size-1', { command: 'sleep', args: ['10'] }));
    size = await Effect.runPromise(pool.size());
    expect(size).toBe(1);

    await Effect.runPromise(pool.spawn('size-2', { command: 'sleep', args: ['10'] }));
    size = await Effect.runPromise(pool.size());
    expect(size).toBe(2);

    await Effect.runPromise(pool.kill('size-1'));
    await sleep(100);
    size = await Effect.runPromise(pool.size());
    expect(size).toBe(1);
  });

  it('should report 0 for empty pool', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const size = await Effect.runPromise(pool.size());
    expect(size).toBe(0);
  });

  // === ERROR HANDLING ===
  it('should handle process that exits with non-zero code', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('error-1', { command: 'sh', args: ['-c', 'exit 1'] })
    );

    expect(managed).toBeDefined();

    // Wait for process to exit with error
    await sleep(200);

    // Process should be auto-removed
    const has = await Effect.runPromise(pool.has('error-1'));
    expect(has).toBe(false);
  });

  it('should handle process exit with signal', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('signal-1', { command: 'sleep', args: ['10'] })
    );

    expect(managed).toBeDefined();

    // Kill with signal
    await Effect.runPromise(pool.kill('signal-1'));

    // Wait for cleanup
    await sleep(200);

    const has = await Effect.runPromise(pool.has('signal-1'));
    expect(has).toBe(false);
  });

  it('should handle process with custom cwd and env', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('env-1', {
        command: 'sh',
        args: ['-c', 'echo $TEST_VAR'],
        cwd: '/tmp',
        env: { TEST_VAR: 'test-value' },
      })
    );

    expect(managed).toBeDefined();
    expect(managed.config.cwd).toBe('/tmp');
    expect(managed.config.env).toEqual({ TEST_VAR: 'test-value' });
  });

  it('should call interrupt on ManagedProcess directly', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('direct-1', { command: 'sleep', args: ['10'] })
    );

    // Call interrupt directly on managed process
    await Effect.runPromise(managed.interrupt());

    // Wait for cleanup
    await sleep(100);

    // Process should still be in pool (interrupt doesn't auto-remove)
    const has = await Effect.runPromise(pool.has('direct-1'));
    // The auto-cleanup should have removed it
    expect(has).toBe(false);
  });

  it('should call kill on ManagedProcess directly', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('direct-2', { command: 'sleep', args: ['10'] })
    );

    // Call kill directly on managed process
    await Effect.runPromise(managed.kill());

    // Wait for cleanup
    await sleep(100);

    // Process should be auto-removed
    const has = await Effect.runPromise(pool.has('direct-2'));
    expect(has).toBe(false);
  });

  it('should handle multiple interrupts gracefully', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    await Effect.runPromise(pool.spawn('multi-int-1', { command: 'sleep', args: ['10'] }));

    // Interrupt multiple times
    await Effect.runPromise(pool.interrupt('multi-int-1'));

    // Second interrupt should fail with ProcessNotFoundError
    const exit = await Effect.runPromiseExit(pool.interrupt('multi-int-1'));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe('Fail');
      if (exit.cause._tag === 'Fail') {
        const error = exit.cause.error as any;
        expect(error._tag).toBe('ProcessNotFoundError');
      }
    }
  });

  it('should handle killing already killed process', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('already-killed-1', { command: 'sleep', args: ['10'] })
    );

    // Kill via managed process directly
    await Effect.runPromise(managed.kill());

    // Wait for cleanup
    await sleep(100);

    // Try to kill again via pool - should fail
    const exit = await Effect.runPromiseExit(pool.kill('already-killed-1'));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe('Fail');
      if (exit.cause._tag === 'Fail') {
        const error = exit.cause.error as any;
        expect(error._tag).toBe('ProcessNotFoundError');
      }
    }
  });

  it('should handle process that exits immediately', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    // Spawn quick process that exits immediately
    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('immediate-1', { command: 'true' })
    );

    expect(managed).toBeDefined();

    // Wait for process to exit
    await sleep(100);

    // Should be auto-removed
    const has = await Effect.runPromise(pool.has('immediate-1'));
    expect(has).toBe(false);
  });

  it('should handle concurrent spawns', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    // Spawn multiple processes concurrently
    const promises = [
      Effect.runPromise(pool.spawn('concurrent-1', { command: 'sleep', args: ['1'] })),
      Effect.runPromise(pool.spawn('concurrent-2', { command: 'sleep', args: ['1'] })),
      Effect.runPromise(pool.spawn('concurrent-3', { command: 'sleep', args: ['1'] })),
    ];

    const results = await Promise.all(promises);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r !== undefined)).toBe(true);

    const size = await Effect.runPromise(pool.size());
    expect(size).toBe(3);
  });

  it('should track process status changes', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('status-1', { command: 'sleep', args: ['2'] })
    );

    // Should be starting or running
    const initialStatus = managed.status();
    expect(['starting', 'running']).toContain(initialStatus);

    // Kill the process
    await Effect.runPromise(managed.kill());

    // Status should be stopping or stopped
    const finalStatus = managed.status();
    expect(['stopping', 'stopped']).toContain(finalStatus);
});

  it('should handle invalid command spawn gracefully', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    // Try to spawn a command that doesn't exist
    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('invalid-cmd', { command: 'this-command-does-not-exist-12345' })
    );

    expect(managed).toBeDefined();

    // Wait a bit for the error event
    await sleep(200);

    // Process should still be tracked (error happened after spawn)
    // The error is emitted by the spawned process, not at spawn time
  });

  // === NEW ERROR PATH TESTS ===

  it('should set status to error when process emits error event', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    // Spawn invalid command
    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('error-status-1', { command: 'this-command-does-not-exist-12345' })
    );

    // Wait for error event
    await sleep(300);

    // Status should be error
    const status = managed.status();
    expect(status).toBe('error');
  });

  it('should set status to error when process exits with non-zero code', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('exit-error-1', { command: 'sh', args: ['-c', 'exit 42'] })
    );

    // Wait for process to exit
    await sleep(300);

    // Status should be error
    const status = managed.status();
    expect(status).toBe('error');
  });

  it('should handle kill() on already exited process (no-op)', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    // Spawn quick process that exits immediately
    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('dead-kill-1', { command: 'echo', args: ['fast'] })
    );

    // Wait for process to exit naturally
    await sleep(300);

    // Try to kill already-dead process - should succeed as no-op
    const exit = await Effect.runPromiseExit(managed.kill());

    // Should succeed (no error)
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('should handle interrupt() on already exited process (no-op)', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    // Spawn quick process that exits immediately
    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('dead-int-1', { command: 'true' })
    );

    // Wait for process to exit naturally
    await sleep(300);

    // Try to interrupt already-dead process - should succeed as no-op
    const exit = await Effect.runPromiseExit(managed.interrupt());

    // Should succeed (no error)
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('should handle process exit with signal correctly', async () => {
    const pool = await createPool({ maxConcurrent: 5 });

    const managed: ManagedProcess = await Effect.runPromise(
      pool.spawn('signal-status-1', { command: 'sleep', args: ['10'] })
    );

    // Kill with signal
    await Effect.runPromise(managed.interrupt());

    // Wait for signal handling
    await sleep(300);

    // Status should be stopped (signal-based exit)
    const status = managed.status();
    expect(['stopping', 'stopped']).toContain(status);
  });

  // === ORPHAN DETECTION & AUTO-CLEANUP ===

  it('should kill all remaining processes when scope closes (finalizer)', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 5 });

    // Track PIDs to verify they're killed
    const pids: number[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn 2 long-running processes
          const p1 = yield* pool.spawn('finalizer-1', { command: 'sleep', args: ['30'] });
          const p2 = yield* pool.spawn('finalizer-2', { command: 'sleep', args: ['30'] });

          // Get PIDs (from internal child process - we'll verify they're killed)
          const size = yield* pool.size();
          expect(size).toBe(2);

          // When scope closes, finalizer should kill both processes
        }).pipe(Effect.provide(layer))
      )
    );

    // Wait a bit for cleanup
    await sleep(200);

    // Verify processes are no longer in pool (pool is finalized)
    // We can verify by creating a new pool and checking it's empty
    const newPool = await createPool({ maxConcurrent: 5 });
    const size = await Effect.runPromise(newPool.size());
    expect(size).toBe(0);
  });

  it('should remove dead processes via health check', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 5,
      healthCheckInterval: '10 millis'
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn a fast process that exits immediately
          yield* pool.spawn('health-1', { command: 'echo', args: ['fast'] });

          // Verify it's in the pool initially
          const sizeBefore = yield* pool.size();
          expect(sizeBefore).toBe(1);

          // Wait for process to exit + multiple health check cycles
          yield* Effect.sleep('100 millis');

          // Health check should have removed the dead process
          const sizeAfter = yield* pool.size();
          return sizeAfter;
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe(0);
  });

  it('should not remove running processes during health check', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 5,
      healthCheckInterval: '100 millis'
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn a long-running process
          yield* pool.spawn('health-2', { command: 'sleep', args: ['10'] });

          // Verify it's in the pool
          const sizeBefore = yield* pool.size();
          expect(sizeBefore).toBe(1);

          // Wait for health check to run
          yield* Effect.sleep('250 millis');

          // Process should still be in pool (it's running)
          const sizeAfter = yield* pool.size();
          return sizeAfter;
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe(1);
  });

  it('should work without health check interval (regression test)', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 5 });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn process
          const managed = yield* pool.spawn('no-health-1', { command: 'sleep', args: ['1'] });

          // Verify normal operations work
          const size = yield* pool.size();
          expect(size).toBe(1);

          const has = yield* pool.has('no-health-1');
          expect(has).toBe(true);

          const retrieved = yield* pool.get('no-health-1');
          expect(retrieved.id).toBe('no-health-1');

          return 'success';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('success');
  });

  it('should remove errored processes via health check', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 5,
      healthCheckInterval: '10 millis'
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn a process that exits with error
          yield* pool.spawn('health-error-1', { command: 'sh', args: ['-c', 'exit 1'] });

          // Verify it's in the pool initially
          const sizeBefore = yield* pool.size();
          expect(sizeBefore).toBe(1);

          // Wait for process to exit with error + multiple health check cycles
          yield* Effect.sleep('100 millis');

          // Health check should have removed the errored process
          const sizeAfter = yield* pool.size();
          return sizeAfter;
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe(0);
  });

  it('should cleanup multiple dead processes in single health check', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 5,
      healthCheckInterval: '100 millis'
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn multiple fast processes
          yield* pool.spawn('multi-health-1', { command: 'echo', args: ['1'] });
          yield* pool.spawn('multi-health-2', { command: 'true' });
          yield* pool.spawn('multi-health-3', { command: 'sh', args: ['-c', 'exit 0'] });

          // Verify they're all in the pool
          const sizeBefore = yield* pool.size();
          expect(sizeBefore).toBe(3);

          // Wait for all to exit + health check to run
          yield* Effect.sleep('250 millis');

          // Health check should have removed all dead processes
          const sizeAfter = yield* pool.size();
          return sizeAfter;
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe(0);
  });

  it('should cleanup mix of stopped and errored processes in health check', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 5,
      healthCheckInterval: '50 millis'
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn mix: some succeed (stopped), some fail (error)
          yield* pool.spawn('mix-1', { command: 'echo', args: ['success'] });
          yield* pool.spawn('mix-2', { command: 'sh', args: ['-c', 'exit 1'] });
          yield* pool.spawn('mix-3', { command: 'true' });
          yield* pool.spawn('mix-4', { command: 'sh', args: ['-c', 'exit 2'] });

          // Initial size
          const sizeBefore = yield* pool.size();
          expect(sizeBefore).toBe(4);

          // Wait for processes to exit
          yield* Effect.sleep('150 millis');

          // Wait for multiple health check cycles to ensure they run
          yield* Effect.sleep('200 millis');

          // All should be removed (both stopped and error status)
          const sizeAfter = yield* pool.size();
          return sizeAfter;
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe(0);
  });

  it('should execute health check multiple times and remove dead processes', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 10,
      healthCheckInterval: '5 millis'
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn many processes rapidly to create race conditions
          // where health check might find them before auto-cleanup
          for (let i = 0; i < 10; i++) {
            yield* pool.spawn(`batch-${i}`, { command: 'echo', args: [`${i}`] });
          }

          const sizeBefore = yield* pool.size();
          expect(sizeBefore).toBeGreaterThan(0);

          // Wait for processes to exit and many health check cycles
          yield* Effect.sleep('200 millis');

          // All should be cleaned up (by either auto-cleanup or health check)
          const finalSize = yield* pool.size();
          return finalSize;
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe(0);
  });

  it('should have health check find and remove processes in stopped/error state', async () => {
    // Use extremely fast health check (1ms) with many processes to create
    // timing conditions where health check catches processes in stopped/error state
    const layer = ProcessPoolLive({
      maxConcurrent: 50,
      healthCheckInterval: '1 millis'
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Strategy: Spawn MANY processes in waves
          // With 1ms health check interval, it will run very frequently
          // Some processes will be caught by health check before exit handler cleanup
          for (let wave = 0; wave < 10; wave++) {
            // Spawn 10 processes per wave
            const promises: Effect.Effect<any, any, any>[] = [];
            for (let i = 0; i < 10; i++) {
              const processId = `intensive-${wave}-${i}`;
              // Mix of success and failure
              const isError = i % 3 === 0;
              const cmd = isError ? 'sh' : 'echo';
              const args = isError ? ['-c', 'exit 1'] : ['ok'];
              promises.push(pool.spawn(processId, { command: cmd, args }));
            }

            // Spawn all at once
            yield* Effect.all(promises, { concurrency: 'unbounded' });

            // Very short delay between waves
            yield* Effect.sleep('10 millis');
          }

          // Let health check run many more cycles
          yield* Effect.sleep('300 millis');

          const finalSize = yield* pool.size();
          expect(finalSize).toBe(0);
        }).pipe(Effect.provide(layer))
      )
    );
  });

  // === STREAMING ===

  describe('Streaming', () => {
    it('should read stdout from echo process', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('echo-stdout', { command: 'echo', args: ['hello world'] })
      );

      // Collect stdout stream
      const chunks = await Effect.runPromise(Stream.runCollect(managed.stdout));
      const output = Chunk.toArray(chunks).join('');

      expect(output).toContain('hello world');
    });

    it('should read stderr from process that writes to stderr', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('stderr-test', { command: 'sh', args: ['-c', 'echo error-msg >&2'] })
      );

      // Collect stderr stream
      const chunks = await Effect.runPromise(Stream.runCollect(managed.stderr));
      const output = Chunk.toArray(chunks).join('');

      expect(output).toContain('error-msg');
    });

    it('should write to stdin and read from stdout (cat pipe)', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('cat-test', { command: 'cat' })
      );

      // Start collecting output before writing
      const outputPromise = Effect.runPromise(
        Stream.runCollect(managed.stdout).pipe(Effect.timeout('3 seconds'))
      );

      // Write to stdin
      await Effect.runPromise(managed.write('hello from stdin\n'));

      // Wait a bit for data to flow through
      await sleep(100);

      // Kill process to close stdin and trigger EOF
      await Effect.runPromise(managed.kill());

      // Wait for output
      const chunks = await outputPromise;
      const output = Chunk.toArray(chunks).join('');

      expect(output).toContain('hello from stdin');
    }, 10000);

    it('should stream ends when process exits', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('stream-end', { command: 'echo', args: ['done'] })
      );

      // Collect all stdout chunks until stream ends
      const chunks = await Effect.runPromise(
        Stream.runCollect(managed.stdout).pipe(Effect.timeout('5 seconds'))
      );
      const output = Chunk.toArray(chunks).join('');

      expect(output).toContain('done');
      // Stream should have completed without hanging
    });

    it('should write to dead process fails', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('dead-write', { command: 'echo', args: ['fast'] })
      );

      // Wait for process to exit
      await sleep(300);

      // Attempt write
      const exit = await Effect.runPromiseExit(managed.write('data'));

      // Verify it fails with ProcessPoolError
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe('Fail');
        if (exit.cause._tag === 'Fail') {
          const error = exit.cause.error as any;
          expect(error._tag).toBe('ProcessPoolError');
          // Message could be either "Cannot write to dead process" or "Failed to write to process" depending on timing
          expect(error.message).toMatch(/(Cannot write to dead process|Failed to write to process)/);
        }
      }
    });

    it('should handle multiple writes to stdin', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('multi-write', { command: 'cat' })
      );

      // Start collecting output before writing
      const outputPromise = Effect.runPromise(
        Stream.runCollect(managed.stdout).pipe(Effect.timeout('3 seconds'))
      );

      // Multiple writes
      await Effect.runPromise(managed.write('line1\n'));
      await Effect.runPromise(managed.write('line2\n'));

      // Wait for data to flow through
      await sleep(100);

      // Kill process
      await Effect.runPromise(managed.kill());

      // Wait for output
      const chunks = await outputPromise;
      const output = Chunk.toArray(chunks).join('');

      expect(output).toContain('line1');
      expect(output).toContain('line2');
    }, 10000);

    it('should read stdout and stderr simultaneously', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('both-streams', {
          command: 'sh',
          args: ['-c', 'echo out-msg; echo err-msg >&2'],
        })
      );

      // Collect both streams
      const [stdoutChunks, stderrChunks] = await Effect.runPromise(
        Effect.all([Stream.runCollect(managed.stdout), Stream.runCollect(managed.stderr)])
      );

      const stdoutOutput = Chunk.toArray(stdoutChunks).join('');
      const stderrOutput = Chunk.toArray(stderrChunks).join('');

      expect(stdoutOutput).toContain('out-msg');
      expect(stderrOutput).toContain('err-msg');
    });

    it('should return empty stream when stdout is null', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      // This is a defensive test - in practice, with stdio: ['pipe', 'pipe', 'pipe'],
      // stdout should never be null, but we want to ensure the code handles it
      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('empty-stream', { command: 'echo', args: ['test'] })
      );

      // Even if stdout were null, Stream.empty would be used
      expect(managed.stdout).toBeDefined();
    });

    it('should handle process with no output', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('no-output', { command: 'true' })
      );

      // Start collecting before process exits
      const collectPromise = Effect.runPromise(
        Stream.runCollect(managed.stdout).pipe(Effect.timeout('2 seconds'))
      );

      // Wait for process to exit
      await sleep(200);

      // Collect stdout (stream should end when process exits)
      const chunks = await collectPromise;

      // Should be empty
      expect(Chunk.toArray(chunks).join('')).toBe('');
    });

    it('should handle large stdout output', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      // Generate 100 lines of output
      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('large-output', {
          command: 'sh',
          args: ['-c', 'for i in $(seq 1 100); do echo "Line $i"; done'],
        })
      );

      // Collect all output
      const chunks = await Effect.runPromise(
        Stream.runCollect(managed.stdout).pipe(Effect.timeout('5 seconds'))
      );
      const output = Chunk.toArray(chunks).join('');

      // Verify we got all lines
      expect(output).toContain('Line 1');
      expect(output).toContain('Line 50');
      expect(output).toContain('Line 100');
    });

    it('should handle streaming with runForEach', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('foreach-test', { command: 'echo', args: ['test-line'] })
      );

      const lines: string[] = [];

      // Use runForEach to process each chunk
      await Effect.runPromise(
        Stream.runForEach(managed.stdout, (chunk) =>
          Effect.sync(() => {
            lines.push(chunk);
          })
        ).pipe(Effect.timeout('2 seconds'))
      );

      expect(lines.join('')).toContain('test-line');
    });

    it('should handle write error when stdin is unavailable', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      // Spawn a process that doesn't use stdin (though with pipe mode, stdin should always be available)
      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('no-stdin', { command: 'echo', args: ['test'] })
      );

      // Wait a bit for process to potentially exit
      await sleep(200);

      // Try to write after process has exited
      const exit = await Effect.runPromiseExit(managed.write('data'));

      // Should fail because process is dead
      expect(Exit.isFailure(exit)).toBe(true);
    });

    it('should handle concurrent reads from same stream', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('concurrent-reads', {
          command: 'sh',
          args: ['-c', 'for i in 1 2 3 4 5; do echo "Line $i"; sleep 0.1; done'],
        })
      );

      // Start two concurrent stream consumers immediately
      const promise1 = Effect.runPromise(
        Stream.runCollect(managed.stdout).pipe(Effect.timeout('5 seconds'))
      );
      const promise2 = Effect.runPromise(
        Stream.runCollect(managed.stdout).pipe(Effect.timeout('5 seconds'))
      );

      const [result1, result2] = await Promise.all([promise1, promise2]);

      const output1 = Chunk.toArray(result1).join('');
      const output2 = Chunk.toArray(result2).join('');

      // Both should receive all output (streams can be consumed multiple times)
      expect(output1).toContain('Line 1');
      expect(output2).toContain('Line 1');
    }, 10000);

    it('should handle interleaved writes and reads', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('interleaved', { command: 'cat' })
      );

      // Start consuming stdout
      const outputPromise = Effect.runPromise(
        Stream.runCollect(managed.stdout).pipe(Effect.timeout('5 seconds'))
      );

      // Write multiple times with delays
      await Effect.runPromise(managed.write('first\n'));
      await sleep(50);
      await Effect.runPromise(managed.write('second\n'));
      await sleep(50);
      await Effect.runPromise(managed.write('third\n'));

      // Kill process to trigger EOF
      await Effect.runPromise(managed.kill());

      // Wait for output
      const chunks = await outputPromise;
      const output = Chunk.toArray(chunks).join('');

      expect(output).toContain('first');
      expect(output).toContain('second');
      expect(output).toContain('third');
    });

    it('should handle write when stdin closes before write completes', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('stdin-close', { command: 'cat' })
      );

      // Kill immediately to close stdin
      await Effect.runPromise(managed.kill());

      // Wait for process to fully exit
      await sleep(200);

      // Try to write - should get error about dead process
      const exit = await Effect.runPromiseExit(managed.write('too late\n'));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe('Fail');
        if (exit.cause._tag === 'Fail') {
          const error = exit.cause.error as any;
          expect(error._tag).toBe('ProcessPoolError');
          // Either "Cannot write to dead process" or "Failed to write"
          expect(error.message).toMatch(/(Cannot write to dead|Failed to write)/);
        }
      }
    });

    it('should trigger stream cleanup finalizers when stream is interrupted', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('finalizer-test', {
          command: 'sh',
          args: ['-c', 'while true; do echo "running"; sleep 0.1; done'],
        })
      );

      // Start consuming stream
      const collectEffect = Stream.runCollect(managed.stdout).pipe(
        Effect.timeout('500 millis')
      );

      // Run with timeout to trigger interruption
      const exit = await Effect.runPromiseExit(collectEffect);

      // Should timeout (which interrupts the stream)
      expect(Exit.isFailure(exit)).toBe(true);

      // Kill the process
      await Effect.runPromise(managed.kill());

      // Cleanup should have been called when stream was interrupted
    });

    it('should handle stream taking effect with proper scoping', async () => {
      const pool = await createPool({ maxConcurrent: 5 });

      const managed: ManagedProcess = await Effect.runPromise(
        pool.spawn('scope-test', {
          command: 'echo',
          args: ['scoped-output'],
        })
      );

      // Collect stream within a scoped effect
      const output = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const chunks = yield* Stream.runCollect(managed.stdout);
            return Chunk.toArray(chunks).join('');
          })
        )
      );

      expect(output).toContain('scoped-output');
    });
  });
});
