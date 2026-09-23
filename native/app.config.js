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
// Each lives as a repository secret (which `.github/workflows/native-build.yml`
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

// THE iCLOUD CONTAINER IS NOT THE BUNDLE ID, and deriving it from one would be
// a mistake. It names a container, registered once in the developer portal and
// addressed by the app and its native module; the listing it ships under is
// not its business. Deriving it would mean a plain checkout addressing
// `iCloud.dev.local.notes` while the module's Swift — which cannot read a
// build variable — said something else, and a store pointed at the wrong
// container syncs nothing while reporting success.
//
// So it is committed, identical in every build, and spelled the same in
// `modules/icloud-store/index.ts` and its Swift. The root test suite
// (`tests/platform/icloud-host.test.ts`) fails if the three drift apart.
const ICLOUD_CONTAINER = "iCloud.se.agilator.notes";

// What the container's folder is called in the Files app. The project's plain
// name, not the listing name: it is the one string of the arrangement a user
// sees, and it must not move between releases. `ICLOUD_FOLDER_NAME` in
// `src/storage/icloud/index.ts` shows the same name in the sync details.
const ICLOUD_FOLDER_NAME = PROJECT_NAME;

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
      entitlements: {
        // What lets the app read and write its iCloud Drive container — the
        // iCloud Drive storage backend (`modules/icloud-store`). The three keys
        // travel together: the service, the container the app may address, and
        // the one it treats as its own.
        "com.apple.developer.icloud-services": ["CloudDocuments"],
        "com.apple.developer.icloud-container-identifiers": [ICLOUD_CONTAINER],
        "com.apple.developer.ubiquity-container-identifiers": [
          ICLOUD_CONTAINER,
        ],
      },
      infoPlist: {
        // Publishes the container's `Documents` folder to the Files app under
        // the app's plain name, so the user can see, copy and back up the notes
        // the app keeps there. Without it the container syncs but stays
        // invisible. Folders nest (namespaces, note folders, attachments), so
        // any depth is allowed.
        NSUbiquitousContainers: {
          [ICLOUD_CONTAINER]: {
            NSUbiquitousContainerIsDocumentScopePublic: true,
            NSUbiquitousContainerSupportedFolderLevels: "Any",
            NSUbiquitousContainerName: ICLOUD_FOLDER_NAME,
          },
        },
      },
    },
    android: {
      package: BUNDLE_ID,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0e1116",
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
