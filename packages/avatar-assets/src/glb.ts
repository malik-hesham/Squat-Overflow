// The binary glTF container (glTF 2.0 spec, "GLB File Format Specification").
const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/** A UTF-8 decoder, e.g. `new TextDecoder()`. Passed in: this package uses no host globals. */
export interface Utf8Decoder {
  decode(bytes: Uint8Array): string;
}

/** Returns the parsed JSON chunk of a GLB file. Throws with a clear message on anything else. */
export function readGlbJson(bytes: Uint8Array, decoder: Utf8Decoder): unknown {
  if (bytes.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) throw new Error('GLB is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a GLB file (bad magic number)');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB version ${version} is not supported (need 2)`);

  const length = view.getUint32(HEADER_BYTES, true);
  const type = view.getUint32(HEADER_BYTES + 4, true);
  if (type !== JSON_CHUNK) throw new Error('GLB has no JSON chunk first');
  const start = HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (start + length > bytes.byteLength) throw new Error('GLB is truncated');
  return JSON.parse(decoder.decode(bytes.subarray(start, start + length))) as unknown;
}
