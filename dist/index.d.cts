import { Duration, Effect, Stream, Context, Layer } from 'effect';
import * as effect_Cause from 'effect/Cause';
import * as effect_Types from 'effect/Types';
import { ChildProcess } from 'node:child_process';

interface PoolConfig {
    readonly maxConcurrent: number;
    readonly idleTimeout?: Duration.DurationInput;
    readonly healthCheckInterval?: Duration.DurationInput;
}
interface ProcessConfig {
    readonly command: string;
    readonly args?: ReadonlyArray<string>;
    readonly cwd?: string;
    readonly env?: Record<string, string>;
}
type ProcessStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'stopped' | 'error';

declare const ProcessPoolError_base: new <A extends Record<string, any> = {}>(args: effect_Types.Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => effect_Cause.YieldableError & {
    readonly _tag: "ProcessPoolError";
} & Readonly<A>;
declare class ProcessPoolError extends ProcessPoolError_base<{
    readonly message: string;
    readonly cause?: unknown;
}> {
}
declare const ProcessLimitError_base: new <A extends Record<string, any> = {}>(args: effect_Types.Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => effect_Cause.YieldableError & {
    readonly _tag: "ProcessLimitError";
} & Readonly<A>;
declare class ProcessLimitError extends ProcessLimitError_base<{
    readonly message: string;
    readonly maxConcurrent: number;
    readonly currentCount: number;
}> {
}
declare const ProcessNotFoundError_base: new <A extends Record<string, any> = {}>(args: effect_Types.Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => effect_Cause.YieldableError & {
    readonly _tag: "ProcessNotFoundError";
} & Readonly<A>;
declare class ProcessNotFoundError extends ProcessNotFoundError_base<{
    readonly message: string;
    readonly processId: string;
}> {
}

interface ManagedProcess {
    readonly id: string;
    readonly config: ProcessConfig;
    readonly status: () => ProcessStatus;
    readonly interrupt: () => Effect.Effect<void, ProcessPoolError>;
    readonly kill: () => Effect.Effect<void, ProcessPoolError>;
    readonly stdout: Stream.Stream<string, ProcessPoolError>;
    readonly stderr: Stream.Stream<string, ProcessPoolError>;
    readonly write: (data: string) => Effect.Effect<void, ProcessPoolError>;
}
declare class ManagedProcessImpl implements ManagedProcess {
    readonly id: string;
    readonly config: ProcessConfig;
    private readonly childProcess;
    private currentStatus;
    readonly stdout: Stream.Stream<string, ProcessPoolError>;
    readonly stderr: Stream.Stream<string, ProcessPoolError>;
    constructor(id: string, config: ProcessConfig, childProcess: ChildProcess);
    private createReadableStream;
    status(): ProcessStatus;
    interrupt(): Effect.Effect<void, ProcessPoolError>;
    kill(): Effect.Effect<void, ProcessPoolError>;
    write(data: string): Effect.Effect<void, ProcessPoolError>;
}

interface ProcessPoolInterface {
    readonly spawn: (id: string, config: ProcessConfig) => Effect.Effect<ManagedProcess, ProcessPoolError | ProcessLimitError>;
    readonly get: (id: string) => Effect.Effect<ManagedProcess, ProcessNotFoundError>;
    readonly kill: (id: string) => Effect.Effect<void, ProcessNotFoundError | ProcessPoolError>;
    readonly interrupt: (id: string) => Effect.Effect<void, ProcessNotFoundError | ProcessPoolError>;
    readonly killAll: () => Effect.Effect<void, ProcessPoolError>;
    readonly size: () => Effect.Effect<number>;
    readonly has: (id: string) => Effect.Effect<boolean>;
}
declare const ProcessPool_base: Context.TagClass<ProcessPool, "ProcessPool", ProcessPoolInterface>;
declare class ProcessPool extends ProcessPool_base {
}

declare const ProcessPoolLive: (config: PoolConfig) => Layer.Layer<ProcessPool>;

export { type ManagedProcess, ManagedProcessImpl, type PoolConfig, type ProcessConfig, ProcessLimitError, ProcessNotFoundError, ProcessPool, ProcessPoolError, type ProcessPoolInterface, ProcessPoolLive, type ProcessStatus };
