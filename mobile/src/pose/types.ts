// The shape of one analysed frame: what extension/lib/pose's Session.process
// returns (the old pose server's "frame" message), on the phone and in the extension.
export type Landmark = [x: number, y: number, visibility: number];

export type RepEvent = {
  score: number;
  partial: boolean;
  issues?: string[];
  issue_text?: string[];
};

export type FrameResult = {
  exercise: string;
  stage: string;
  feedback: { code: string; text: string }[];
  rep_event: RepEvent | null;
  summary: { reps: number };
  landmarks: Landmark[] | null;
};

export type CoachStatus = 'starting' | 'open' | 'camera-denied' | 'offline';
