import { globSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';
import { DEPENDENCY_FIELDS, type WorkspacePackage } from './boundaries.ts';

/** Reads every package matched by pnpm-workspace.yaml's `packages` globs. */
export function loadWorkspace(root: string): WorkspacePackage[] {
  const config: unknown = parseYaml(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  const globs = (config as { packages?: unknown }).packages;
  if (!Array.isArray(globs) || !globs.every((g) => typeof g === 'string')) {
    throw new Error('pnpm-workspace.yaml: `packages` must be a list of globs');
  }
  return globs
    .flatMap((glob) => globSync(`${glob}/package.json`, { cwd: root }))
    .sort()
    .map((file) => readPackage(root, file));
}

function readPackage(root: string, file: string): WorkspacePackage {
  const json = JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>;
  const name = json['name'];
  if (typeof name !== 'string') throw new Error(`${file}: has no name`);
  const fields: Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>> = {};
  for (const field of DEPENDENCY_FIELDS) {
    const deps = json[field];
    if (deps !== undefined) fields[field] = deps as Record<string, string>;
  }
  return { name, dir: relative(root, dirname(join(root, file))), fields };
}

const TEST_FILE = /\.test(-d)?\.ts$/;

/** Every file TypeScript loads to compile the project, libs and global types included. */
export function programFiles(tsconfigPath: string): string[] {
  return compiledFiles(tsconfigPath, () => true);
}

/**
 * Like programFiles, but for what the package ships: test files are left out. Tests may use Node
 * (reading fixtures from disk) by starting with `/// <reference types="node" />`.
 */
export function shippedProgramFiles(tsconfigPath: string): string[] {
  return compiledFiles(tsconfigPath, (file) => !TEST_FILE.test(file));
}

function compiledFiles(tsconfigPath: string, include: (file: string) => boolean): string[] {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, undefined, host);
  if (!parsed) throw new Error(`${tsconfigPath}: could not be read`);
  const [error] = parsed.errors;
  if (error) {
    throw new Error(`${tsconfigPath}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  }
  const rootNames = parsed.fileNames.filter(include);
  const program = ts.createProgram({ rootNames, options: parsed.options });
  // A type library that can't be found loads no files, which would look "pure"; fail instead.
  const [broken] = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
  if (broken) {
    throw new Error(
      `${tsconfigPath}: ${ts.flattenDiagnosticMessageText(broken.messageText, '\n')}`
    );
  }
  return program.getSourceFiles().map((file) => file.fileName);
}
