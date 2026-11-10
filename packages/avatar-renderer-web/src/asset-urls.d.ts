// Model files are imported by URL (Vite's `?url`), so bundlers copy them and hand back where they are.
declare module '*.glb?url' {
  const url: string;
  export default url;
}
