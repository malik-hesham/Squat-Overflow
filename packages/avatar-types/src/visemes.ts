/**
 * The engine's canonical mouth shapes: the 15 Oculus (OVR) visemes. Speech providers' own sets
 * (Amazon Polly, Azure Speech) are mapped to these on the server, so clients only ever see these ids.
 */
export const VISEMES = [
  'sil',
  'PP',
  'FF',
  'TH',
  'DD',
  'kk',
  'CH',
  'SS',
  'nn',
  'RR',
  'aa',
  'E',
  'I',
  'O',
  'U',
] as const;

export type VisemeId = (typeof VISEMES)[number];

const IDS: ReadonlySet<unknown> = new Set(VISEMES);

export function isVisemeId(value: unknown): value is VisemeId {
  return IDS.has(value);
}
