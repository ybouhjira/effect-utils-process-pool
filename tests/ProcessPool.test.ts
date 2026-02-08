import { describe, it, expect } from 'vitest';
import { ProcessPool } from '../src/ProcessPool.js';

describe('ProcessPool', () => {
  it('should export ProcessPool tag', () => {
    expect(ProcessPool).toBeDefined();
  });
});
