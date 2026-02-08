# @effect-utils/process-pool

[![CI](https://github.com/ybouhjira/effect-utils-process-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/ybouhjira/effect-utils-process-pool/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@effect-utils%2Fprocess-pool.svg)](https://www.npmjs.com/package/@effect-utils/process-pool)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/ybouhjira/effect-utils-process-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Effect-based process pool with lifecycle management, concurrency limits, and orphan cleanup.

## Features

- **Lifecycle Management**: Automatic cleanup of child processes via Effect scopes
- **Concurrency Control**: Configurable max concurrent processes
- **Idle Timeout**: Auto-terminate idle processes after configurable timeout
- **Health Checks**: Periodic monitoring of process status
- **Orphan Cleanup**: Graceful shutdown with interrupt/kill support
- **Type-Safe**: Full TypeScript support with strict types
- **100% Test Coverage**: Comprehensive test suite enforced via CI

## Installation

```bash
npm install @effect-utils/process-pool effect @effect/platform @effect/platform-node
```

## Quick Start

```typescript
import { Effect } from 'effect';
import { ProcessPool, ProcessConfig } from '@effect-utils/process-pool';

// Define pool configuration
const poolConfig = {
  maxConcurrent: 5,
  idleTimeout: '5 minutes',
  healthCheckInterval: '30 seconds',
};

// Spawn a process
const program = Effect.gen(function* () {
  const pool = yield* ProcessPool;

  const processConfig: ProcessConfig = {
    command: 'node',
    args: ['worker.js'],
    cwd: '/path/to/workdir',
    env: { NODE_ENV: 'production' },
  };

  // Spawn managed process
  const process = yield* pool.spawn('worker-1', processConfig);

  // Check status
  console.log(process.status()); // 'running'

  // Gracefully interrupt
  yield* process.interrupt();

  // Or forcefully kill
  yield* process.kill();
});

// Run with cleanup
Effect.runPromise(program);
```

## API

### ProcessPool

The main service for managing a pool of child processes.

#### Methods

| Method | Description |
|--------|-------------|
| `spawn(id, config)` | Spawn a new managed process |
| `get(id)` | Retrieve a managed process by ID |
| `kill(id)` | Kill a specific process |
| `interrupt(id)` | Gracefully interrupt a specific process |
| `killAll()` | Kill all processes in the pool |
| `size()` | Get current process count |
| `has(id)` | Check if process exists |

### ManagedProcess

Represents a managed child process with lifecycle control.

#### Properties

- `id: string` - Unique process identifier
- `config: ProcessConfig` - Process configuration
- `status(): ProcessStatus` - Current process status

#### Methods

- `interrupt(): Effect<void, ProcessPoolError>` - Graceful shutdown (SIGINT)
- `kill(): Effect<void, ProcessPoolError>` - Forceful shutdown (SIGKILL)

### Types

```typescript
interface PoolConfig {
  maxConcurrent: number;
  idleTimeout?: Duration.DurationInput;
  healthCheckInterval?: Duration.DurationInput;
}

interface ProcessConfig {
  command: string;
  args?: ReadonlyArray<string>;
  cwd?: string;
  env?: Record<string, string>;
}

type ProcessStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'stopped' | 'error';
```

## Error Handling

The library provides three specific error types:

- `ProcessPoolError` - General pool errors
- `ProcessLimitError` - Max concurrent limit exceeded
- `ProcessNotFoundError` - Process ID not found

```typescript
import { Effect, Match } from 'effect';
import { ProcessLimitError, ProcessNotFoundError } from '@effect-utils/process-pool';

const handleErrors = (error: unknown) =>
  Match.value(error).pipe(
    Match.tag('ProcessLimitError', (e) =>
      console.error(`Pool limit reached: ${e.maxConcurrent}`)
    ),
    Match.tag('ProcessNotFoundError', (e) =>
      console.error(`Process not found: ${e.processId}`)
    ),
    Match.orElse((e) => console.error('Unknown error:', e))
  );
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format

# Build
npm run build
```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes with tests
4. Ensure 100% coverage: `npm run test:coverage`
5. Format and lint: `npm run format && npm run lint`
6. Commit: `git commit -m "feat: add my feature"`
7. Push: `git push origin feature/my-feature`
8. Open a Pull Request

## License

MIT © Youssef Bouhjira
