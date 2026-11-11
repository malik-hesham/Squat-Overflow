/**
 * Pins plugins/withSceneLifecycle.js, the UIScene life cycle that iOS 27 requires,
 * against Expo SDK 56's template AppDelegate.swift (fixtures/AppDelegate.sdk56.swift,
 * exactly as `expo prebuild` writes it). iOS 26 simulators don't enforce the scene
 * requirement, so a regression here only shows when launching on iOS 27.
 */
import { applySceneDelegate, applySceneManifest, SCENE_MANIFEST } from '../withSceneLifecycle';

// Node's fs, as in src/pose/analysis/__tests__/helpers.ts (the app's types have no Node).
declare const require: (id: 'fs') => { readFileSync(file: string, encoding: 'utf8'): string };
declare const __dirname: string;
const read = (file: string) => require('fs').readFileSync(`${__dirname}/${file}`, 'utf8');

const template = read('fixtures/AppDelegate.sdk56.swift');
const count = (src: string, needle: string) => src.split(needle).length - 1;
const didFinishLaunching = (src: string) =>
  src.slice(src.indexOf('didFinishLaunchingWithOptions launchOptions'), src.indexOf('// Linking API'));
const sceneDelegate = (src: string) => src.slice(src.indexOf('class SceneDelegate'));

describe('Info.plist', () => {
  test('declares one window scene served by SceneDelegate', () => {
    const plist = applySceneManifest({ CFBundleName: 'Squat Overflow' });
    expect(plist.CFBundleName).toBe('Squat Overflow');
    expect(plist.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    });
    expect(applySceneManifest(plist)).toEqual(plist);
  });
});

describe('AppDelegate.swift', () => {
  const patched = applySceneDelegate(template);

  test('the fixture is the template the plugin expects', () => {
    expect(didFinishLaunching(template)).toContain('window = UIWindow(frame: UIScreen.main.bounds)');
    expect(count(template, 'factory.startReactNative(')).toBe(1);
  });

  test('didFinishLaunching builds the factory but no longer creates the window or starts React Native', () => {
    const launch = didFinishLaunching(patched);
    expect(launch).toContain('let factory = ExpoReactNativeFactory(delegate: delegate)');
    expect(launch).toContain('reactNativeFactory = factory');
    expect(launch).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
    expect(launch).not.toContain('UIWindow(');
    expect(launch).not.toContain('startReactNative');
  });

  test('SceneDelegate creates the window from the scene and starts React Native in it', () => {
    const scene = sceneDelegate(patched);
    expect(scene).toMatch(/^class SceneDelegate: UIResponder, UIWindowSceneDelegate \{/);
    expect(scene).toContain('scene(\n    _ scene: UIScene,\n    willConnectTo session: UISceneSession,');
    expect(scene).toContain('UIApplication.shared.delegate as? AppDelegate');
    expect(scene).toContain('let window = UIWindow(windowScene: windowScene)');
    expect(scene).toContain('appDelegate.window = window');
    expect(scene).toContain('factory.startReactNative(\n      withModuleName: "main",\n      in: window,');
    expect(count(patched, 'startReactNative(')).toBe(1);
    // Info.plist names the scene delegate by this class name.
    const plistClass = SCENE_MANIFEST.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName;
    expect(scene).toMatch(new RegExp(`^class ${plistClass.split('.').pop()}:`));
  });

  test('links and user activities reach the AppDelegate handlers', () => {
    const scene = sceneDelegate(patched);
    // Cold launch: the link is in the connection options. Pass it on as launch options,
    // then to the AppDelegate handlers (the dev client and expo-linking read it there).
    expect(scene).toContain('options[.url] = context.url');
    expect(scene).toContain('options[.userActivityDictionary]');
    const connect = scene.slice(scene.indexOf('willConnectTo'), scene.indexOf('private static func launchOptions'));
    expect(connect).toContain('self.scene(scene, openURLContexts: connectionOptions.urlContexts)');
    expect(connect).toContain('self.scene(scene, continue: activity)');
    expect(connect.indexOf('startReactNative')).toBeLessThan(connect.indexOf('openURLContexts:'));
    // While running: iOS calls the scene, not application(_:open:options:).
    expect(scene).toContain('func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>)');
    expect(scene).toContain('appDelegate.application(UIApplication.shared, open: context.url, options: options)');
    expect(scene).toContain('func scene(_ scene: UIScene, continue userActivity: NSUserActivity)');
    // The template's own handlers stay in AppDelegate.
    expect(patched).toContain('RCTLinkingManager.application(app, open: url, options: options)');
    expect(patched).toContain('RCTLinkingManager.application(application, continue: userActivity');
  });

  test('keeps the rest of the template as it was', () => {
    const generatedStart = patched.indexOf('// @generated begin squat-overflow-scene-delegate');
    expect(generatedStart).toBeGreaterThan(0);
    const restored = patched
      .slice(0, generatedStart)
      .trimEnd()
      .replace(/ +\/\/ withSceneLifecycle: .*\n/, '');
    const templateWithoutLaunch = template
      .trimEnd()
      .replace(/#if os\(iOS\) \|\| os\(tvOS\)\n[\s\S]*?#endif\n/, '');
    expect(restored).toBe(templateWithoutLaunch);
  });

  test('running prebuild again changes nothing', () => {
    const twice = applySceneDelegate(patched);
    expect(twice).toBe(patched);
    expect(count(twice, 'class SceneDelegate')).toBe(1);
    expect(count(twice, '// @generated begin squat-overflow-scene-delegate')).toBe(1);
  });

  test('fails loudly on a template it does not know', () => {
    const changed = template.replace('window = UIWindow(frame: UIScreen.main.bounds)', 'window = makeWindow()');
    expect(() => applySceneDelegate(changed)).toThrow(/doesn't create the window/);
    const adopted = `${template}\nclass SceneDelegate: UIResponder, UIWindowSceneDelegate {}\n`;
    expect(() => applySceneDelegate(adopted)).toThrow(/drop plugins\/withSceneLifecycle\.js/);
  });
});

test('app.json runs the plugin on every prebuild', () => {
  const app = JSON.parse(read('../../app.json'));
  expect(app.expo.plugins).toContain('./plugins/withSceneLifecycle');
});
