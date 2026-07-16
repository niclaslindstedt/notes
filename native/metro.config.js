// The native app is a thin WebView wrapper: it loads a *prebuilt* copy of the
// web app (embedded in the binary) rather than importing the web source, so
// Metro only needs to bundle this project's own small RN shell. No repo-root
// watch or React singleton pinning is required anymore.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
