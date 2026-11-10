# Digital human: measured performance

Only measured numbers go here, each with the device, the browser and the method. Targets (from the
spec): desktop 60 fps, browser 30 to 60 fps, mobile 30 to 60 fps. A frame at 60 fps has 16.7 ms.

## Web renderer, frame cost (2026-11-10, Phase 3)

**Device:** the development Mac, Apple M5 (10-core GPU, Metal 4), 24 GB, macOS 26.6.
**Browser:** Chrome for Testing 1248 (Chromium), headless, WebGL 2 through ANGLE on Metal
(`ANGLE Metal Renderer: Apple M5`), device pixel ratio 2.
**Method:** the preview page's measure mode (`preview-page/main.ts`, `?measure=300`): after 30
warm-up frames, 300 frames of pose (`rig.apply`) + draw + a one-pixel read-back, which makes the
browser wait until the GPU has finished the frame. `performance.now()` resolution is 0.1 ms. What's
on screen: the avatar's body clip and rest face (the face and eye layers come in Phase 4).

| Profile   | Framing  | Drawing buffer | Triangles | Median | 95th percentile |
| --------- | -------- | -------------- | --------- | ------ | --------------- |
| HIGH      | full     | 2560 × 1446    | 93,024    | 1.2 ms | 2.6 ms          |
| HIGH      | portrait | 2560 × 1446    | 93,024    | 1.4 ms | 2.7 ms          |
| OPTIMIZED | portrait | 800 × 1106     | 39,388    | 0.7 ms | 1.4 ms          |
| OPTIMIZED | full     | 800 × 1106     | 39,388    | 0.6 ms | 1.9 ms          |
| OPTIMIZED | portrait | 2560 × 1446    | 39,388    | 1.2 ms | 2.6 ms          |

So on this Mac, drawing the avatar uses at most about a sixth of a 60 fps frame, at the 95th
percentile.

## Mobile (spike S1, 2026-11-10)

**Device:** iPhone 12 (A14), iOS 27.0.1. **Stack:** Expo 56, React Native 0.85.3 (Hermes), `expo-gl`,
three 0.187, React Three Fiber 9.8 native, Release build. **Method:** frames counted for 10 s in the app's
render loop (the real display), plus the JavaScript time per frame of posing (clip and face shapes).
Details and the fixes it needed: [spike-s1-mobile.md](spike-s1-mobile.md).

| Model                   | Resolution          | Average  | Frame gap median | 95th percentile | JS posing |
| ----------------------- | ------------------- | -------- | ---------------- | --------------- | --------- |
| OPTIMIZED, PNG textures | 1170 × 2532 (DPR 3) | 53.2 fps | 16.72 ms         | 16.87 ms        | 0.75 ms   |
| OPTIMIZED, no textures  | 1170 × 2532 (DPR 3) | 53.7 fps | 16.71 ms         | 16.92 ms        | 0.72 ms   |

At least 95% of frames hit the display's 60 Hz; a few long ones (likely shader compilation at the start)
pull the average to 53. Without the Phase 4 face layers and without audio.

## Not measured yet

- **Frames shown per second in a visible window.** Headless Chrome paces `requestAnimationFrame`
  itself (it gave 44 to 53 fps with the frame costs above, which says nothing about the avatar), and
  the app's browser pane was hidden, so its loop didn't run.
- Windows (WebView2) and Linux (WebKitGTK): Phase 7.
- Android phones (S1 covered the iPhone 12 only); older iPhones.
- With the face and procedural layers (Phase 4) and lip sync (Phase 5) running.
- Memory over a long session, and the cost of loading (download and decode).
- Older or integrated GPUs. An M5 is fast; this is the best case, not the typical one.
