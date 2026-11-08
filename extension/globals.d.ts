// Globals that avatar-global.js puts on the page for trainer.js, which is a
// classic script and can't import them.
import type { Avatar as AvatarApi } from "./avatar.js";

declare global {
  var Avatar: typeof AvatarApi;
  var POSE_SERVER_URL: string;
}
