/**
 * WebSocket close code 1013 "Try Again Later": the pose server is at its session cap
 * (FORMCOACH_MAX_SESSIONS) and closed this socket before "ready". trainer.js, a classic
 * script, checks the same number inline.
 */
export const CLOSE_BUSY = 1013;

/**
 * What a closed pose socket means for the UI.
 * @param {number} code CloseEvent.code
 * @returns {"busy" | "offline"}
 */
export function closeStatus(code) {
  return code === CLOSE_BUSY ? "busy" : "offline";
}
