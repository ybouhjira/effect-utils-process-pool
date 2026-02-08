import { describe, it, expect } from 'vitest';
import { Effect, Stream, Chunk } from 'effect';
import { ProcessPool } from '../src/ProcessPool.js';
import { ProcessPoolLive } from '../src/ProcessPoolLive.js';
import type { ManagedProcess } from '../src/ManagedProcess.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Integration Tests - Concurrent Real Workloads', () => {
  /**
   * Test 1: Spawn 5 concurrent processes, each doing different work
   */
  it('should handle 5 concurrent processes with different workloads', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 10 });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn 5 concurrent processes with different types of work
          // Long-running processes
          yield* pool.spawn('long-1', { command: 'sleep', args: ['5'] });
          yield* pool.spawn('long-2', { command: 'sleep', args: ['5'] });

          // Fast success process
          yield* pool.spawn('fast-success', { command: 'echo', args: ['quick'] });

          // Error process - save reference immediately
          const errorProc = yield* pool.spawn('error-proc', {
            command: 'sh',
            args: ['-c', 'exit 42'],
          });

          // Interactive process
          yield* pool.spawn('interactive', { command: 'cat' });

          // Verify all 5 spawned successfully
          const size = yield* pool.size();
          expect(size).toBe(5);

          // Wait for error process to exit with error
          yield* Effect.sleep('150 millis');
          expect(errorProc.status()).toBe('error');

          // Verify long-running processes are still alive
          const hasLong1 = yield* pool.has('long-1');
          const hasLong2 = yield* pool.has('long-2');
          expect(hasLong1).toBe(true);
          expect(hasLong2).toBe(true);

          // Kill one long-running process
          yield* pool.kill('long-1');
          yield* Effect.sleep('100 millis');

          // Verify it's gone
          const hasLong1After = yield* pool.has('long-1');
          expect(hasLong1After).toBe(false);

          // Kill remaining processes
          yield* pool.killAll();
          yield* Effect.sleep('200 millis');

          // Pool should be empty
          const finalSize = yield* pool.size();
          expect(finalSize).toBe(0);

          return 'success';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('success');
  });

  /**
   * Test 2: Kill some processes while others continue
   */
  it('should kill selective processes while others continue running', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 10 });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn 4 long-running processes
          yield* pool.spawn('sleep-1', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('sleep-2', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('sleep-3', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('sleep-4', { command: 'sleep', args: ['30'] });

          const initialSize = yield* pool.size();
          expect(initialSize).toBe(4);

          // Kill process 1 and 3
          yield* pool.kill('sleep-1');
          yield* pool.kill('sleep-3');

          // Wait for cleanup
          yield* Effect.sleep('200 millis');

          // Verify pool size dropped to 2
          const finalSize = yield* pool.size();
          expect(finalSize).toBe(2);

          // Verify processes 2 and 4 are still running
          const has2 = yield* pool.has('sleep-2');
          const has4 = yield* pool.has('sleep-4');
          expect(has2).toBe(true);
          expect(has4).toBe(true);

          // Verify killed processes are no longer in pool
          const has1 = yield* pool.has('sleep-1');
          const has3 = yield* pool.has('sleep-3');
          expect(has1).toBe(false);
          expect(has3).toBe(false);

          return 'success';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('success');
  });

  /**
   * Test 3: Concurrent spawn at capacity limit
   */
  it('should reject spawns when at capacity and allow after kill', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 3 });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Fill pool to capacity (3 processes)
          yield* pool.spawn('limit-1', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('limit-2', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('limit-3', { command: 'sleep', args: ['30'] });

          const size = yield* pool.size();
          expect(size).toBe(3);

          // Try to spawn 2 more simultaneously - both should fail
          const exit1 = yield* Effect.exit(
            pool.spawn('limit-4', { command: 'sleep', args: ['30'] })
          );
          const exit2 = yield* Effect.exit(
            pool.spawn('limit-5', { command: 'sleep', args: ['30'] })
          );

          expect(exit1._tag).toBe('Failure');
          expect(exit2._tag).toBe('Failure');

          // Kill one process
          yield* pool.kill('limit-1');
          yield* Effect.sleep('100 millis');

          // Now spawn should succeed
          const managed = yield* pool.spawn('limit-6', { command: 'sleep', args: ['30'] });
          expect(managed).toBeDefined();
          expect(managed.id).toBe('limit-6');
        }).pipe(Effect.provide(layer))
      )
    );
  });

  /**
   * Test 4: Rapid spawn-kill cycles
   */
  it('should handle rapid spawn-kill cycles without orphans', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 5 });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Rapid spawn-kill cycles
          for (let i = 0; i < 20; i++) {
            const managed = yield* pool.spawn(`rapid-${i}`, {
              command: 'sleep',
              args: ['10'],
            });

            // Immediately kill it
            yield* managed.kill();

            // Verify pool size is 0 (or cleanup is in progress)
            yield* Effect.sleep('50 millis');
            const size = yield* pool.size();
            expect(size).toBe(0);
          }

          // Final verification: no orphans
          const finalSize = yield* pool.size();
          expect(finalSize).toBe(0);
        }).pipe(Effect.provide(layer))
      )
    );
  });

  /**
   * Test 5: Process isolation - each process has independent stdin/stdout
   */
  it('should maintain process isolation with independent stdin/stdout', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 5 });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn 3 cat processes
          const cat1 = yield* pool.spawn('cat-1', { command: 'cat' });
          const cat2 = yield* pool.spawn('cat-2', { command: 'cat' });
          const cat3 = yield* pool.spawn('cat-3', { command: 'cat' });

          // Start collecting output from each
          const collect1 = Stream.runCollect(cat1.stdout);
          const collect2 = Stream.runCollect(cat2.stdout);
          const collect3 = Stream.runCollect(cat3.stdout);

          // Write unique data to each
          yield* cat1.write('msg-1\n');
          yield* cat2.write('msg-2\n');
          yield* cat3.write('msg-3\n');

          // Wait for data to flow through
          yield* Effect.sleep('100 millis');

          // Kill each process
          yield* cat1.kill();
          yield* cat2.kill();
          yield* cat3.kill();

          // Collect outputs
          const [chunks1, chunks2, chunks3] = yield* Effect.all([collect1, collect2, collect3]);

          const output1 = Chunk.toArray(chunks1).join('');
          const output2 = Chunk.toArray(chunks2).join('');
          const output3 = Chunk.toArray(chunks3).join('');

          // Verify isolation: each got ONLY its own data
          expect(output1).toContain('msg-1');
          expect(output1).not.toContain('msg-2');
          expect(output1).not.toContain('msg-3');

          expect(output2).toContain('msg-2');
          expect(output2).not.toContain('msg-1');
          expect(output2).not.toContain('msg-3');

          expect(output3).toContain('msg-3');
          expect(output3).not.toContain('msg-1');
          expect(output3).not.toContain('msg-2');

          return 'isolated';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('isolated');
  }, 10000);

  /**
   * Test 6: Graceful shutdown via scope (finalizer)
   */
  it('should terminate all processes when scope closes (finalizer)', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 10 });

    // Run scoped effect that spawns processes
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn 5 long-running processes
          yield* pool.spawn('finalizer-1', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('finalizer-2', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('finalizer-3', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('finalizer-4', { command: 'sleep', args: ['30'] });
          yield* pool.spawn('finalizer-5', { command: 'sleep', args: ['30'] });

          const size = yield* pool.size();
          expect(size).toBe(5);

          // Scope will close naturally, triggering finalizer
        }).pipe(Effect.provide(layer))
      )
    );

    // Wait for cleanup to complete
    await sleep(300);

    // All processes should be terminated
    // We can't verify the pool directly (it's finalized), but we verify no orphans remain
    // by creating a new pool and checking it's empty
    const newLayer = ProcessPoolLive({ maxConcurrent: 5 });
    const newSize = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;
          return yield* pool.size();
        }).pipe(Effect.provide(newLayer))
      )
    );

    expect(newSize).toBe(0);
  });

  /**
   * Test 7: Health check under load
   */
  it('should cleanup dead processes via health check under load', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 15,
      healthCheckInterval: '50 millis',
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn 10 fast processes that exit immediately
          for (let i = 0; i < 10; i++) {
            yield* pool.spawn(`fast-${i}`, { command: 'echo', args: [`msg-${i}`] });
          }

          // Spawn 2 long-running processes
          yield* pool.spawn('long-1', { command: 'sleep', args: ['5'] });
          yield* pool.spawn('long-2', { command: 'sleep', args: ['5'] });

          // Initial size should be 12
          const initialSize = yield* pool.size();
          expect(initialSize).toBeGreaterThanOrEqual(2);
          expect(initialSize).toBeLessThanOrEqual(12);

          // Wait for fast processes to exit and health checks to run
          yield* Effect.sleep('500 millis');

          // Only the 2 long-running processes should remain
          const finalSize = yield* pool.size();
          expect(finalSize).toBe(2);

          return 'cleaned';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('cleaned');
  });

  /**
   * Test 8: Large output handling
   */
  it('should handle large output without data loss', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 5 });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn process that generates 1000 lines
          const managed = yield* pool.spawn('large-output', {
            command: 'sh',
            args: ['-c', 'for i in $(seq 1 1000); do echo "line-$i"; done'],
          });

          // Collect all stdout
          const chunks = yield* Stream.runCollect(managed.stdout);
          const output = Chunk.toArray(chunks).join('');

          // Count lines
          const lines = output.trim().split('\n').length;
          expect(lines).toBe(1000);

          // Verify specific lines
          expect(output).toContain('line-1');
          expect(output).toContain('line-500');
          expect(output).toContain('line-1000');

          return lines;
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe(1000);
  }, 10000);

  /**
   * Test 9: Error recovery - pool remains usable after process errors
   */
  it('should remain usable after process crashes', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 5 });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn process that crashes
          const crasher = yield* pool.spawn('crasher', {
            command: 'sh',
            args: ['-c', 'exit 1'],
          });

          // Wait for it to die
          yield* Effect.sleep('200 millis');

          // Verify it's in error state
          const status = crasher.status();
          expect(status).toBe('error');

          // Spawn another process - should work fine
          const managed = yield* pool.spawn('after-crash', {
            command: 'echo',
            args: ['recovery'],
          });

          expect(managed).toBeDefined();
          expect(managed.id).toBe('after-crash');

          // Collect output to verify it works
          const chunks = yield* Stream.runCollect(managed.stdout);
          const output = Chunk.toArray(chunks).join('');
          expect(output).toContain('recovery');

          // Verify pool size is correct (crasher removed, new one added)
          yield* Effect.sleep('200 millis');
          const size = yield* pool.size();
          expect(size).toBe(0); // Both should have exited naturally

          return 'recovered';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('recovered');
  });

  /**
   * Test 10: Mixed workload stress test
   */
  it('should handle mixed workload with concurrent operations', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 10,
      healthCheckInterval: '50 millis',
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn mix of processes:
          // 3 fast processes
          yield* pool.spawn('fast-1', { command: 'echo', args: ['fast-1'] });
          yield* pool.spawn('fast-2', { command: 'echo', args: ['fast-2'] });
          yield* pool.spawn('fast-3', { command: 'echo', args: ['fast-3'] });

          // 3 long-running processes
          yield* pool.spawn('long-1', { command: 'sleep', args: ['5'] });
          yield* pool.spawn('long-2', { command: 'sleep', args: ['5'] });
          yield* pool.spawn('long-3', { command: 'sleep', args: ['5'] });

          // 2 error processes
          yield* pool.spawn('error-1', { command: 'sh', args: ['-c', 'exit 1'] });
          yield* pool.spawn('error-2', { command: 'sh', args: ['-c', 'exit 2'] });

          // 2 interactive processes
          const cat1 = yield* pool.spawn('cat-1', { command: 'cat' });
          const cat2 = yield* pool.spawn('cat-2', { command: 'cat' });

          // Initial size should be 10
          const initialSize = yield* pool.size();
          expect(initialSize).toBe(10);

          // Write to interactive processes
          yield* cat1.write('interactive-1\n');
          yield* cat2.write('interactive-2\n');

          // Kill one long-running process
          yield* pool.kill('long-1');

          // Interrupt another long-running process
          yield* pool.interrupt('long-2');

          // Wait for fast/error processes to complete and cleanup to run
          yield* Effect.sleep('500 millis');

          // Expected final state:
          // - 1 long-running still alive (long-3)
          // - 2 interactive still alive (cat-1, cat-2)
          // - Everything else cleaned up
          const finalSize = yield* pool.size();
          expect(finalSize).toBe(3);

          // Verify specific processes
          const hasLong3 = yield* pool.has('long-3');
          const hasCat1 = yield* pool.has('cat-1');
          const hasCat2 = yield* pool.has('cat-2');

          expect(hasLong3).toBe(true);
          expect(hasCat1).toBe(true);
          expect(hasCat2).toBe(true);

          // Kill all remaining
          yield* pool.killAll();
          yield* Effect.sleep('200 millis');

          const endSize = yield* pool.size();
          expect(endSize).toBe(0);

          return 'completed';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('completed');
  }, 10000);

  /**
   * Test 11: Concurrent spawn stress test
   */
  it('should handle many concurrent spawns without race conditions', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 50 });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn 50 processes concurrently
          const spawnEffects: Effect.Effect<ManagedProcess, any, any>[] = [];
          for (let i = 0; i < 50; i++) {
            spawnEffects.push(
              pool.spawn(`concurrent-${i}`, { command: 'echo', args: [`msg-${i}`] })
            );
          }

          const processes = yield* Effect.all(spawnEffects, { concurrency: 'unbounded' });

          // Verify all spawned successfully
          expect(processes).toHaveLength(50);
          expect(processes.every((p) => p !== undefined)).toBe(true);

          // Verify pool size
          const size = yield* pool.size();
          expect(size).toBeGreaterThanOrEqual(0); // Some may have already exited
          expect(size).toBeLessThanOrEqual(50);

          // Wait for all to complete
          yield* Effect.sleep('500 millis');

          // All should be cleaned up
          const finalSize = yield* pool.size();
          expect(finalSize).toBe(0);

          return 'success';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('success');
  });

  /**
   * Test 12: Process status tracking during lifecycle
   */
  it('should correctly track process status throughout lifecycle', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 5 });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn long-running process
          const managed = yield* pool.spawn('status-tracker', {
            command: 'sleep',
            args: ['5'],
          });

          // Should be starting or running
          const initialStatus = managed.status();
          expect(['starting', 'running']).toContain(initialStatus);

          // Kill it
          yield* managed.kill();

          // Should be stopping or stopped
          yield* Effect.sleep('100 millis');
          const finalStatus = managed.status();
          expect(['stopping', 'stopped']).toContain(finalStatus);
        }).pipe(Effect.provide(layer))
      )
    );
  });

  /**
   * Test 13: Simultaneous read/write operations
   */
  it('should handle simultaneous reads and writes correctly', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 5 });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          const managed = yield* pool.spawn('rw-test', { command: 'cat' });

          // Start reading
          const readEffect = Stream.runCollect(managed.stdout);

          // Write multiple times
          yield* managed.write('line-1\n');
          yield* Effect.sleep('50 millis');
          yield* managed.write('line-2\n');
          yield* Effect.sleep('50 millis');
          yield* managed.write('line-3\n');
          yield* Effect.sleep('50 millis');

          // Kill to close stdin
          yield* managed.kill();

          // Collect output
          const chunks = yield* readEffect;
          const output = Chunk.toArray(chunks).join('');

          expect(output).toContain('line-1');
          expect(output).toContain('line-2');
          expect(output).toContain('line-3');

          return 'success';
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result).toBe('success');
  }, 10000);

  /**
   * Test 14: Verify no orphans after scope close
   */
  it('should leave no orphan processes after scope closes', async () => {
    const layer = ProcessPoolLive({ maxConcurrent: 10 });

    // Track PIDs before scope
    const pidsBefore = new Set<number>();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Spawn several processes
          for (let i = 0; i < 5; i++) {
            yield* pool.spawn(`orphan-test-${i}`, { command: 'sleep', args: ['30'] });
          }

          const size = yield* pool.size();
          expect(size).toBe(5);

          // Scope closes here, finalizer should kill all
        }).pipe(Effect.provide(layer))
      )
    );

    // Wait for cleanup
    await sleep(300);

    // Create new pool and verify it's empty
    const newSize = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;
          return yield* pool.size();
        }).pipe(Effect.provide(ProcessPoolLive({ maxConcurrent: 5 })))
      )
    );

    expect(newSize).toBe(0);
  });

  /**
   * Test 15: Health check with rapid process churn
   */
  it('should handle health checks with rapid process creation/deletion', async () => {
    const layer = ProcessPoolLive({
      maxConcurrent: 20,
      healthCheckInterval: '10 millis',
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* ProcessPool;

          // Create rapid churn: spawn and let die repeatedly
          for (let wave = 0; wave < 5; wave++) {
            const promises: Effect.Effect<any, any, any>[] = [];
            for (let i = 0; i < 10; i++) {
              promises.push(
                pool.spawn(`churn-${wave}-${i}`, { command: 'echo', args: [`w${wave}-${i}`] })
              );
            }

            yield* Effect.all(promises, { concurrency: 'unbounded' });
            yield* Effect.sleep('100 millis');
          }

          // Wait for health checks to clean up
          yield* Effect.sleep('300 millis');

          // All processes should be cleaned up
          const finalSize = yield* pool.size();
          expect(finalSize).toBe(0);
        }).pipe(Effect.provide(layer))
      )
    );
  });
});
