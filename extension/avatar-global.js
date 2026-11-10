// The Practice page (trainer.js) is a classic script with no module loader, so it reads the
// characters and the on-device pose model from these globals. trainer.html loads this module first
// and trainer.js with `defer`: deferred and module scripts run in document order, so both exist by
// the time trainer.js starts.
import { Avatar } from "./avatar.js";
import { CONNECTIONS, exerciseCatalog } from "./lib/pose/index.js";
import { CLOSE_MODEL_FAILED, openPoseSocket } from "./lib/pose/local-socket.js";
import { demoMotion } from "./lib/demo-model.js";
import { createDemoPlayer } from "./lib/demo-player.js";

globalThis.Avatar = Avatar;
globalThis.Demo3D = { has: (key) => demoMotion(key) != null, createPlayer: createDemoPlayer };
globalThis.PoseLocal = {
  exerciseCatalog,
  CONNECTIONS,
  CLOSE_MODEL_FAILED,
  openPoseSocket: () => openPoseSocket({ createDetector: async () => (await import("./lib/pose/detector.js")).createDetector() }),
};
