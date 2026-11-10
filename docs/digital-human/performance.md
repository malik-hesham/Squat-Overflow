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

## Not measured yet

- **Frames shown per second in a visible window.** Headless Chrome paces `requestAnimationFrame`
  itself (it gave 44 to 53 fps with the frame costs above, which says nothing about the avatar), and
  the app's browser pane was hidden, so its loop didn't run.
- Windows (WebView2) and Linux (WebKitGTK): Phase 7.
- Phones: spike S1, after Phase 3.
- With the face and procedural layers (Phase 4) and lip sync (Phase 5) running.
- Memory over a long session, and the cost of loading (download and decode).
- Older or integrated GPUs. An M5 is fast; this is the best case, not the typical one.
