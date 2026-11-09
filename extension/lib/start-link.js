// start.html: the page the Mac menu bar app opens for Break now. It sends the same "break-now"
// message as the popup's Break now button, then closes its own tab. The page isn't listed in
// web_accessible_resources, so websites can't open it; only the browser itself can (a typed URL,
// or one another app hands to Chrome).

/**
 * @param {{ send: (msg: { type: "break-now" }) => Promise<any>, closeTab: () => Promise<void> }} io
 * @returns {Promise<boolean>} whether the break window opened; on false the tab stays open to show why
 */
export async function startBreakFromLink({ send, closeTab }) {
  let res;
  try {
    res = await send({ type: "break-now" });
  } catch {
    return false;
  }
  if (res?.ok !== true) return false;
  await closeTab();
  return true;
}
