// Expo app config.
//
// Executable rather than a static `app.json` because the values that identify
// this app IN THE STORES are not checked in. The repository is the project;
// the store listing is a deployment of it, and a deployment's coordinates
// belong in configuration, not in source. Three of them are read from build
// variables here:
//
//   APP_DISPLAY_NAME  the listing name, and the name shown under the icon
//   APP_BUNDLE_ID     iOS bundle identifier + Android package name — the
//                     latter is literally the Play Store URL, so it is the
//                     most public of the three
//   EAS_PROJECT_ID    the Expo project this builds against
//
// Each lives as a repository variable (which `.github/workflows/native-build.yml`
// forwards) AND as an EAS environment variable on the EAS project, because EAS
// resolves this file again on its own builders. Unset, each falls back to a
// local development default below, so a plain checkout still runs `expo start`
// — but a store build with them unset is wrong, which `assertConfigured` makes
// loud rather than silent.
//
// `slug` and `scheme` stay literal: they are the project's own name, they are
// not listing coordinates, and EAS resolves the project by slug.

const PROJECT_NAME = "Notes";

/** Reverse-DNS id used only by local/dev builds; never submitted. */
const DEV_BUNDLE_ID = "dev.local.notes";

const DISPLAY_NAME = process.env.APP_DISPLAY_NAME?.trim() || PROJECT_NAME;
const BUNDLE_ID = process.env.APP_BUNDLE_ID?.trim() || DEV_BUNDLE_ID;
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID?.trim();

// A `production` build is one headed for a store, so the fallbacks above are
// not good enough: fail here rather than uploading a binary under the dev
// bundle id or the project name. EAS sets EAS_BUILD_PROFILE on its builders.
if (process.env.EAS_BUILD_PROFILE === "production") {
  for (const name of ["APP_DISPLAY_NAME", "APP_BUNDLE_ID", "EAS_PROJECT_ID"]) {
    if (!process.env[name]?.trim()) {
      throw new Error(
        `${name} is not set. A production build needs it — set it as an EAS ` +
          `environment variable on the EAS project (and as a repository ` +
          `variable for the Native build workflow). See RELEASING.md.`,
      );
    }
  }
}

module.exports = {
  expo: {
    name: DISPLAY_NAME,
    slug: "notes",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    scheme: "notes",
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#1d2027",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: BUNDLE_ID,
    },
    android: {
      package: BUNDLE_ID,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1f2933",
      },
    },
    web: {
      bundler: "metro",
    },
    plugins: [
      "./plugins/with-web-bundle.js",
      [
        "expo-camera",
        {
          cameraPermission: `${DISPLAY_NAME} uses the camera only to scan a notesd server's pairing QR code.`,
        },
      ],
    ],
    // Omitted entirely when unset, so EAS falls back to resolving the project
    // by slug instead of being handed an empty id.
    ...(EAS_PROJECT_ID
      ? { extra: { eas: { projectId: EAS_PROJECT_ID } } }
      : {}),
  },
};
