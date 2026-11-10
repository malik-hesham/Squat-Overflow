// Runs the boundary rules on the real workspace. Not cached by Turborepo (see ../turbo.json):
// it reads every package's package.json and tsconfig, not just this folder.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDependencies } from './boundaries.ts';
import { findGlobalTypes } from './globals.ts';
import { RULES } from './rules.ts';
import { loadWorkspace, programFiles } from './workspace.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const packages = loadWorkspace(ROOT);

describe('the workspace', () => {
  it('has the packages of the phases built so far', () => {
    expect(packages.map((p) => p.name)).toEqual(
      expect.arrayContaining(['@squat-overflow/avatar-types', '@squat-overflow/workspace-check'])
    );
  });

  it('follows its package boundary rules', () => {
    expect(checkDependencies(packages, RULES)).toEqual([]);
  });

  const pure = packages.filter((p) => RULES[p.name]?.pure);
  it('has pure packages to check', () => {
    expect(pure.map((p) => p.name)).toContain('@squat-overflow/avatar-types');
  });

  it.each(pure.map((p) => [p.name, p.dir] as const))(
    '%s compiles with no browser, Node or React Native globals',
    (_name, dir) => {
      expect(findGlobalTypes(programFiles(`${ROOT}/${dir}/tsconfig.json`))).toEqual([]);
    }
  );
});

describe('programFiles', () => {
  it('fails when the project asks for global types it cannot find, instead of passing silently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workspace-check-'));
    try {
      writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n');
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { types: ['no-such-types'] }, files: ['index.ts'] })
      );

      expect(() => programFiles(join(dir, 'tsconfig.json'))).toThrow(
        /tsconfig\.json: Cannot find type definition file for 'no-such-types'/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
