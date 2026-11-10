// Two kinds of tests: the adapter in Node (three's scene graph needs no WebGL), and the loader and
// view in a real Chromium (WebGL, WebP textures). CHROMIUM_PATH points at a local Chromium when the
// one Playwright expects isn't installed (CI installs it: `pnpm exec playwright install chromium`).
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                ...(process.env['CHROMIUM_PATH']
                  ? { executablePath: process.env['CHROMIUM_PATH'] }
                  : {}),
                // Software WebGL, so the tests run the same on machines with no GPU (CI).
                args: [
                  '--use-angle=swiftshader',
                  '--enable-unsafe-swiftshader',
                  '--ignore-gpu-blocklist',
                ],
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
