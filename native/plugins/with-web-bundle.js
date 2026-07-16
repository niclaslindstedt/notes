// Expo config plugin: embed the compiled web app (built by `make build-native`
// into `native/web/`) into the native binary at prebuild.
//
//   - Android: copy it into `android/app/src/main/assets/web/`, which Gradle
//     packages into the APK and the WebView loads from
//     `file:///android_asset/web/index.html`.
//   - iOS: copy it into the iOS project and add it to the app target as a
//     *folder reference* (blue folder) so the whole hashed-asset tree ships in
//     the bundle and the WebView loads it from `bundleDirectory/web/index.html`.
//
// Run `make build-native` before `expo prebuild` so `native/web/` exists.

const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withXcodeProject,
  IOSConfig,
} = require("@expo/config-plugins");

const WEB_DIR = "web";

function copyDir(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(
      `[with-web-bundle] ${from} not found — run \`make build-native\` first.`,
    );
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

function withAndroidWebBundle(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, WEB_DIR);
      const dest = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
        WEB_DIR,
      );
      copyDir(src, dest);
      return cfg;
    },
  ]);
}

function withIosWebBundleCopy(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, WEB_DIR);
      const dest = path.join(cfg.modRequest.platformProjectRoot, WEB_DIR);
      copyDir(src, dest);
      return cfg;
    },
  ]);
}

function withIosWebBundleReference(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.getFirstTarget().uuid;
    // Add `web` as a folder reference so the entire tree (hashed asset
    // filenames included) is copied into the bundle verbatim.
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: WEB_DIR,
      groupName: cfg.modRequest.projectName,
      project,
      isBuildFile: true,
      verbose: false,
      // `folder` makes Xcode treat it as a folder reference, not a group.
      addFileToProject: { lastKnownFileType: "folder" },
    });
    return cfg;
  });
}

module.exports = function withWebBundle(config) {
  config = withAndroidWebBundle(config);
  config = withIosWebBundleCopy(config);
  config = withIosWebBundleReference(config);
  return config;
};
