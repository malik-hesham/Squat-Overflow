// The shape of one analysed frame: what the Python pose server sent as a
// "frame" message, and what src/pose/analysis's Session.process returns.
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
