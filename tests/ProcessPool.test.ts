import { describe, it, expect, afterEach } from 'vitest';
import { Effect, Exit } from 'effect';
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
});
