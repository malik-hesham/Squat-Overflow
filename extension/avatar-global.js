// The Practice page (trainer.js) is a classic script with no module loader,
// so it reads the characters and the default pose server from these globals.
// trainer.html loads this module first and trainer.js with `defer`: deferred
// and module scripts run in document order, so both exist by the time trainer.js starts.
import { Avatar } from "./avatar.js";
import { POSE_SERVER_URL } from "./config.js";

globalThis.Avatar = Avatar;
globalThis.POSE_SERVER_URL = POSE_SERVER_URL;
