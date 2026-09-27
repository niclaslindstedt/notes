// Default Expo Metro config plus one addition: `.zip` is a bundled ASSET.
// The whole web build is packed into `assets/webroot.zip`
// (scripts/bundle-web.mjs) and `require()`d by src/local-server.ts, so Metro
// has to ship it in the app bundle rather than try to parse it as source.

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("zip")) {
  config.resolver.assetExts.push("zip");
}

module.exports = config;
