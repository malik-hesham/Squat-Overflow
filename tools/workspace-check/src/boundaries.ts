/** The dependency fields of a package.json that the boundary rules look at. */
export const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;
export type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

/** One package of the workspace, as read from its package.json. */
export interface WorkspacePackage {
  readonly name: string;
  /** Folder relative to the workspace root, e.g. `packages/avatar-core`. */
  readonly dir: string;
  readonly fields: Readonly<Partial<Record<DependencyField, Readonly<Record<string, string>>>>>;
}

export interface BoundaryRule {
  /** Workspace packages this package may depend on. */
  readonly internal: readonly string[];
  /** Packages it must never depend on, in any field. A trailing `*` matches any suffix. */
  readonly forbidden: readonly string[];
  /** Its compiled program may load no DOM lib and no global types (see findGlobalTypes). */
  readonly pure: boolean;
}

export type Rules = Readonly<Record<string, BoundaryRule>>;

/** Returns one readable message per broken rule; empty when the workspace follows them all. */
export function checkDependencies(packages: readonly WorkspacePackage[], rules: Rules): string[] {
  const workspace = new Set(packages.map((p) => p.name));
  const problems: string[] = [];
  for (const pkg of packages) {
    const rule = rules[pkg.name];
    const where = `${pkg.name} (${pkg.dir})`;
    if (!rule) {
      problems.push(`${where} has no boundary rule; add one to tools/workspace-check/src/rules.ts`);
      continue;
    }
    for (const field of DEPENDENCY_FIELDS) {
      for (const dep of Object.keys(pkg.fields[field] ?? {})) {
        if (workspace.has(dep)) {
          if (!rule.internal.includes(dep)) {
            const allowed = rule.internal.length ? rule.internal.join(', ') : 'none';
            problems.push(
              `${where} may not depend on workspace package ${dep} (${field}); allowed: ${allowed}`
            );
          }
        } else if (rule.forbidden.some((pattern) => matches(pattern, dep))) {
          problems.push(`${where} must not depend on ${dep} (${field})`);
        }
      }
    }
  }
  return problems;
}

function matches(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}
