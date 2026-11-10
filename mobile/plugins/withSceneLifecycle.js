// iOS 27 stops apps built with the iOS 27 SDK at launch (SIGTRAP in
// _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption) unless they adopt
// the UIScene life cycle. Expo SDK 56's template has no scene support, so on every
// prebuild this plugin:
//   1. adds a UIApplicationSceneManifest with one window scene to Info.plist, and
//   2. in AppDelegate.swift, leaves didFinishLaunching building the React Native
//      factory but moves creating the window and startReactNative into a
//      SceneDelegate class appended to the same file (so project.pbxproj needn't
//      change). The SceneDelegate also hands links and user activities, which iOS
//      now sends to the scene, to the AppDelegate handlers Expo and React Native use.
// Drop this plugin once Expo's template adopts scenes itself.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');
const {
  createGeneratedHeaderComment,
  removeGeneratedContents,
} = require('@expo/config-plugins/build/utils/generateCode');

const TAG = 'squat-overflow-scene-delegate';
const LAUNCH_MOVED_NOTE = '// withSceneLifecycle: SceneDelegate (end of file) creates the window and starts React Native.';

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
  },
};

// The template's window setup in didFinishLaunching (Expo SDK 56).
const TEMPLATE_LAUNCH =
  /^#if os\(iOS\) \|\| os\(tvOS\)\n[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n[ \t]*factory\.startReactNative\(\s*withModuleName:\s*"([^"]+)",\s*in: window,\s*launchOptions: launchOptions\)\n#endif\n/m;

function sceneDelegateSource(moduleName) {
  return `// UIScene life cycle (iOS 27). Info.plist's UIApplicationSceneManifest names this class.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else {
      fatalError("SceneDelegate: AppDelegate must create reactNativeFactory in didFinishLaunching")
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(
      withModuleName: "${moduleName}",
      in: window,
      launchOptions: SceneDelegate.launchOptions(from: connectionOptions))

    // Then hand the launching link or activity to AppDelegate, as UIKit does after
    // didFinishLaunching without scenes: the dev client loads its URL from there, and
    // expo-linking takes its initial URL from there.
    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    if let activity = connectionOptions.userActivities.first {
      self.scene(scene, continue: activity)
    }
  }

  // A link or activity that launches the app now comes in the connection options, not
  // in didFinishLaunching's launch options, where React Native's Linking.getInitialURL
  // and the dev client look for it. Rebuild those launch options.
  private static func launchOptions(
    from connectionOptions: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    var options: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let context = connectionOptions.urlContexts.first {
      options[.url] = context.url
      if let source = context.options.sourceApplication {
        options[.sourceApplication] = source
      }
    }
    if let activity = connectionOptions.userActivities.first {
      options[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }
    return options.isEmpty ? nil : options
  }

  // Links and activities that arrive while the app runs also go to the scene. Forward
  // them to AppDelegate, whose handlers reach Expo's subscribers and RCTLinkingManager.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace,
      ]
      if let source = context.options.sourceApplication {
        options[.sourceApplication] = source
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity) { _ in }
  }
}`;
}

function applySceneManifest(infoPlist) {
  return { ...infoPlist, UIApplicationSceneManifest: SCENE_MANIFEST };
}

function applySceneDelegate(src) {
  const withoutBlock = removeGeneratedContents(src, TAG) ?? src;
  if (/\bclass SceneDelegate\b/.test(withoutBlock)) {
    throw new Error(
      "withSceneLifecycle: AppDelegate.swift already has a SceneDelegate. Expo's template " +
        'probably adopts scenes now; drop plugins/withSceneLifecycle.js.'
    );
  }

  let contents = withoutBlock;
  let moduleName;
  const launch = contents.match(TEMPLATE_LAUNCH);
  if (launch) {
    moduleName = launch[1];
    contents = contents.replace(TEMPLATE_LAUNCH, `    ${LAUNCH_MOVED_NOTE}\n`);
  } else if (src.includes(LAUNCH_MOVED_NOTE)) {
    // Already patched: reuse the module name from the previous SceneDelegate block.
    moduleName = (src.match(/withModuleName: "([^"]+)",\n\s*in: window,\n\s*launchOptions: SceneDelegate/) ?? [])[1];
  }
  if (!moduleName) {
    throw new Error(
      "withSceneLifecycle: didFinishLaunching in AppDelegate.swift doesn't create the window " +
        "the way Expo SDK 56's template does. Update plugins/withSceneLifecycle.js for the new template."
    );
  }

  const block = sceneDelegateSource(moduleName);
  return [
    contents.trimEnd(),
    '',
    createGeneratedHeaderComment(block, TAG, '//'),
    block,
    `// @generated end ${TAG}`,
    '',
  ].join('\n');
}

function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults = applySceneManifest(cfg.modResults);
    return cfg;
  });
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error(`withSceneLifecycle: expected a Swift AppDelegate, got ${cfg.modResults.language}`);
    }
    cfg.modResults.contents = applySceneDelegate(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withSceneLifecycle;
module.exports.applySceneManifest = applySceneManifest;
module.exports.applySceneDelegate = applySceneDelegate;
module.exports.SCENE_MANIFEST = SCENE_MANIFEST;
