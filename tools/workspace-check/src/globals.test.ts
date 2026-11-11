import { describe, expect, it } from 'vitest';
import { findGlobalTypes } from './globals.ts';

describe('findGlobalTypes', () => {
  it('reports DOM, web worker and Node global declarations, and nothing else', () => {
    const files = [
      '/r/node_modules/typescript/lib/lib.es2022.d.ts',
      '/r/node_modules/typescript/lib/lib.dom.d.ts',
      '/r/node_modules/typescript/lib/lib.dom.iterable.d.ts',
      '/r/node_modules/typescript/lib/lib.webworker.d.ts',
      '/r/node_modules/.pnpm/@types+node@24.19.2/node_modules/@types/node/globals.d.ts',
      '/r/node_modules/.pnpm/vitest@5.1.0/node_modules/vitest/dist/index.d.ts',
      '/r/packages/avatar-core/src/index.ts',
      '/r/packages/dom-tools/src/lib.dom.ts',
    ];

    expect(findGlobalTypes(files)).toEqual([
      '/r/node_modules/typescript/lib/lib.dom.d.ts',
      '/r/node_modules/typescript/lib/lib.dom.iterable.d.ts',
      '/r/node_modules/typescript/lib/lib.webworker.d.ts',
      '/r/node_modules/.pnpm/@types+node@24.19.2/node_modules/@types/node/globals.d.ts',
    ]);
  });
});
