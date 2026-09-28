// THE ONE PLACE A DEPLOYMENT'S COORDINATES ENTER THIS REPOSITORY.
//
// The repository is the project; a store listing is a deployment of it. So the
// listing's name and identifier are configuration, not source: they arrive as
// build variables and are never committed. What is committed is the project's
// own plain name and a development id, which is what a fresh checkout runs
// under.
//
//   APP_DISPLAY_NAME  the listing name, and the name shown under the icon
//   APP_BUNDLE_ID     iOS bundle identifier + Android package name — the
//                     latter is literally the Play Store URL, so it is the
//                     most public of the three
//   EAS_PROJECT_ID    the Expo project this builds against
//
// Each lives as a repository secret (which `.github/workflows/native-build.yml`
// forwards) AND as an EAS environment variable on the EAS project, because EAS
// resolves the config again on its own builders. Unset, each falls back to a
// local development default below, so a plain checkout still runs `expo start`
// — but a store build with them unset is wrong, which the check at the end of
// this file makes loud rather than silent.

/** The project's own name. Not the listing name — see APP_DISPLAY_NAME. */
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
// (`tests/native_icloud_test.ts`) fails if the three drift apart.
/** The iCloud Drive container the notes sync through. */
const ICLOUD_CONTAINER = "iCloud.se.agilator.notes";

// A `production` build is one headed for a store, so the fallbacks above are
// not good enough: fail here rather than uploading a binary under the dev
// bundle id or the project name. EAS sets EAS_BUILD_PROFILE on its builders.
if (process.env.EAS_BUILD_PROFILE === "production") {
  for (const name of ["APP_DISPLAY_NAME", "APP_BUNDLE_ID", "EAS_PROJECT_ID"]) {
    if (!process.env[name]?.trim()) {
      throw new Error(
        `${name} is not set. A production build needs it — set it as an EAS ` +
          `environment variable on the EAS project (and as a repository ` +
          `secret for the Native build workflow). See RELEASING.md.`,
      );
    }
  }
}

module.exports = {
  PROJECT_NAME,
  DEV_BUNDLE_ID,
  DISPLAY_NAME,
  BUNDLE_ID,
  EAS_PROJECT_ID,
  ICLOUD_CONTAINER,
};
