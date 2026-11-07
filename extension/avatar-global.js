// The Practice page (trainer.js) is a classic script with no module loader,
// so it reads the characters from this global. trainer.html loads this module
// first and trainer.js with `defer`: deferred and module scripts run in
// document order, so `Avatar` exists by the time trainer.js starts.
import { Avatar } from "./avatar.js";

globalThis.Avatar = Avatar;
