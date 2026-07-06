// The long-form feature docs under `docs/features/*.md`, inlined by Vite at
// build time so the changelog modal can open one in place when a "Learn
// more" link is followed. The app is a static bundle with no backend, so the
// docs can't be fetched at runtime — `import.meta.glob` with `?raw` pulls
// every doc into the bundle here, mirroring how `data.ts` inlines
// `CHANGELOG.md`. The parsing lives in @niclaslindstedt/oss-framework; this
// module owns only the glob (what gets bundled is app content).
import {
  buildFeatureDocs,
  type FeatureDoc,
} from "@niclaslindstedt/oss-framework/changelog";

export {
  parseFeatureDoc,
  type FeatureDoc,
} from "@niclaslindstedt/oss-framework/changelog";

// Eagerly inline every `docs/features/*.md` as a raw string. The path is
// relative to this file: `src/ui/changelog/` → repo root is three levels up,
// then `docs/features/`.
const rawDocs = import.meta.glob<string>("../../../docs/features/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const FEATURE_DOCS: Record<string, FeatureDoc> =
  buildFeatureDocs(rawDocs);
