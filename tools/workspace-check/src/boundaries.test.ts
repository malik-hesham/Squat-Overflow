import { describe, expect, it } from 'vitest';
import { checkDependencies, type Rules, type WorkspacePackage } from './boundaries.ts';

const RULES: Rules = {
  '@x/types': { internal: [], forbidden: ['react', 'expo-*'], pure: true },
  '@x/core': { internal: ['@x/types'], forbidden: ['react', 'expo-*'], pure: true },
};

function pkg(name: string, fields: Partial<WorkspacePackage['fields']> = {}): WorkspacePackage {
  return { name, dir: name.replace('@x/', 'packages/'), fields };
}

describe('checkDependencies', () => {
  it('reports nothing when every package follows its rule', () => {
    const packages = [
      pkg('@x/types', { devDependencies: { vitest: '^5.1.0' } }),
      pkg('@x/core', { dependencies: { '@x/types': 'workspace:*' } }),
    ];

    expect(checkDependencies(packages, RULES)).toEqual([]);
  });

  it.each(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const)(
    'reports a forbidden dependency in %s',
    (field) => {
      const packages = [pkg('@x/core', { [field]: { react: '^19.0.0' } })];

      expect(checkDependencies(packages, RULES)).toEqual([
        `@x/core (packages/core) must not depend on react (${field})`,
      ]);
    }
  );

  it('treats a trailing * as "starts with", and nothing else as a pattern', () => {
    const packages = [
      pkg('@x/core', {
        dependencies: { 'expo-gl': '~56.0.0', nexpo: '1.0.0', 'react-dom': '^19.0.0' },
      }),
    ];

    expect(checkDependencies(packages, RULES)).toEqual([
      '@x/core (packages/core) must not depend on expo-gl (dependencies)',
    ]);
  });

  it('reports a dependency on a workspace package the rule does not allow', () => {
    const packages = [
      pkg('@x/types', { dependencies: { '@x/core': 'workspace:*' } }),
      pkg('@x/core', { dependencies: { '@x/types': 'workspace:*' } }),
    ];

    expect(checkDependencies(packages, RULES)).toEqual([
      '@x/types (packages/types) may not depend on workspace package @x/core (dependencies); allowed: none',
    ]);
  });

  it('reports a workspace package that has no rule', () => {
    const packages = [pkg('@x/types'), pkg('@x/renderer', { dependencies: { react: '^19.0.0' } })];

    expect(checkDependencies(packages, RULES)).toEqual([
      '@x/renderer (packages/renderer) has no boundary rule; add one to tools/workspace-check/src/rules.ts',
    ]);
  });
});
