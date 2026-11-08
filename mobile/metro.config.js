const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// The app reuses the extension's pure logic (XP, schedule, routine, challenges,
// leaderboard, i18n) straight from ../extension/lib, so both clients score and
// schedule breaks the same way. See src/core/shared.ts.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../extension')];
// Files under ../extension resolve packages (e.g. Babel's runtime helpers) from here.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
