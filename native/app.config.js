// Expo app config.
//
// Executable rather than a static `app.json` because the values that identify
// this app IN THE STORES are not checked in: the listing name, the bundle id
// and the EAS project arrive as build variables, resolved in
// `./identifiers.js`, which also throws for a `production` build with any of
// them missing.
//
// `slug` stays literal: it is the project's own name, not a listing
// coordinate, and EAS resolves the project by slug.
//
// The URL `scheme` is the bundle id, not the slug. It is what a sign-in comes
// back on — the Dropbox authentication session returns on
// `<scheme>://oauth` (`src/authSessionBridge.ts`) — and a reverse-DNS scheme
// is the one no other app can plausibly claim (RFC 8252 §7.1). So it follows
// APP_BUNDLE_ID like the identifiers do: `se.agilator.notes` in the store
// build, `dev.local.notes` in a plain checkout, never a committed literal.

const {
  PROJECT_NAME,
  DISPLAY_NAME,
  BUNDLE_ID,
  EAS_PROJECT_ID,
  ICLOUD_CONTAINER,
} = require("./identifiers.js");

// What the iCloud container's folder is called in the Files app. The
// project's plain name, not the listing name: it is the one string of the
// arrangement a user sees, and it must not move between releases.
// `ICLOUD_FOLDER_NAME` in `src/storage/icloud/index.ts` shows the same name in
// the sync details.
const ICLOUD_FOLDER_NAME = PROJECT_NAME;

module.exports = {
  expo: {
    name: DISPLAY_NAME,
    slug: "notes",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    scheme: BUNDLE_ID,
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
        // The bundled build is served over plain HTTP on the loopback
        // interface (`src/local-server.ts`). ATS stays ON — only `localhost`
        // is excepted for cleartext, as in every wrapper in the fleet.
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: true,
          NSExceptionDomains: {
            localhost: {
              NSExceptionAllowsInsecureHTTPLoads: true,
              NSIncludesSubdomains: false,
            },
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
      // The bundled static server (lighttpd, via
      // @dr.pogodin/react-native-static-server) needs Android minSdk 28, and
      // the loopback origin is plain HTTP, so cleartext has to be permitted.
      [
        "expo-build-properties",
        { android: { minSdkVersion: 28, usesCleartextTraffic: true } },
      ],
    ],
    // Omitted entirely when unset, so EAS falls back to resolving the project
    // by slug instead of being handed an empty id.
    ...(EAS_PROJECT_ID
      ? { extra: { eas: { projectId: EAS_PROJECT_ID } } }
      : {}),
  },
};
