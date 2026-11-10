/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readGlbJson } from './glb.ts';

const decoder = new TextDecoder();

/** A minimal GLB: header + JSON chunk (+ optional BIN chunk), per the glTF 2.0 spec. */
function glb(
  json: unknown,
  { magic = 0x46546c67, version = 2, extraBin = false } = {}
): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const bin = extraBin ? new Uint8Array(8) : new Uint8Array(0);
  const total = 12 + 8 + jsonBytes.length + (extraBin ? 8 + bin.length : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, version, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  if (extraBin) {
    view.setUint32(20 + jsonBytes.length, bin.length, true);
    view.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  }
  return out;
}

describe('readGlbJson', () => {
  it("returns a GLB's JSON, non-ASCII names included", () => {
    const json = { asset: { version: '2.0' }, nodes: [{ name: 'Zoë' }] };

    expect(readGlbJson(glb(json, { extraBin: true }), decoder)).toEqual(json);
  });

  it.each([
    ['not a GLB', glb({}, { magic: 0x12345678 }), 'not a GLB file (bad magic number)'],
    ['GLB version 1', glb({}, { version: 1 }), 'GLB version 1 is not supported (need 2)'],
    ['cut short', glb({ asset: {} }).slice(0, 18), 'GLB is truncated'],
  ])('rejects %s', (_name, bytes, message) => {
    expect(() => readGlbJson(bytes, decoder)).toThrow(message);
  });
});
