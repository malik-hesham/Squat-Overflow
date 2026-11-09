// The extension's leaderboard client, pointed at the phone's Google session.
import { API_URL } from '../../../extension/config.js';
import { fetchBoard as fetchSharedBoard, submitScore as submitSharedScore } from '../../../extension/lib/leaderboard.js';
import { getSession } from './session';
import type { Profile, Settings } from './store';

export type Period = 'week' | 'all';
export type BoardRow = { rank: number; name: string; level: number; xp: number; streak: number; avatar: string; is_me: boolean; company: string };

export const BOARD = { url: API_URL, session: getSession };

/** Puts my score on my company's board, or with `remove` takes it off. Resolves false on any failure. */
export function submitScore(profile: Profile, settings: Settings, { remove = false }: { remove?: boolean } = {}): Promise<boolean> {
  return submitSharedScore(profile, settings, { remove }, BOARD);
}

/** My company's board, or null when it can't be loaded or I'm signed out. */
export async function fetchBoard(period: Period): Promise<BoardRow[] | null> {
  return (await fetchSharedBoard(period, BOARD)) as BoardRow[] | null;
}
