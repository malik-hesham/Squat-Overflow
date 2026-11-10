const HOST_LIB = /\/typescript\/lib\/lib\.(dom|webworker|scripthost)\b[^/]*\.d\.ts$/;
const HOST_TYPES = ['/@types/node/', '/@types/react-native/', '/node_modules/react-native/'];

/**
 * Of the files a TypeScript program loads, returns those that declare host globals: the DOM and
 * web worker libs, and Node's or React Native's global types. A pure package must load none.
 */
export function findGlobalTypes(programFiles: readonly string[]): string[] {
  return programFiles.filter(
    (file) => HOST_LIB.test(file) || HOST_TYPES.some((part) => file.includes(part))
  );
}
