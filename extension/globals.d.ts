// Globals that avatar-global.js puts on the page for trainer.js, which is a
// classic script and can't import them.
import type { Avatar as AvatarApi } from "./avatar.js";

declare global {
  var Avatar: typeof AvatarApi;
  var PoseLocal: {
    exerciseCatalog: typeof import("./lib/pose/index.js").exerciseCatalog;
    CONNECTIONS: typeof import("./lib/pose/index.js").CONNECTIONS;
    CLOSE_MODEL_FAILED: number;
    openPoseSocket: () => import("./lib/pose/local-socket.js").PoseSocket;
  };
  var Demo3D: {
    has: (key: string) => boolean;
    createPanel: (els: Parameters<typeof import("./lib/demo-panel.js").createDemoPanel>[0]) => ReturnType<typeof import("./lib/demo-panel.js").createDemoPanel>;
  };
}
