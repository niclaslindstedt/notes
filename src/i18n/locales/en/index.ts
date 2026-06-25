// Composed English catalog. Each top-level group lives in its own file under
// this directory; this index re-assembles them so the rest of the app keeps a
// single `en` object to import. The `Catalog` type is derived here, then
// consumed by `sv/index.ts` and the runtime in `src/i18n/index.ts`.

import type { Widen } from "./_widen.ts";

import achievements from "./achievements.ts";
import app from "./app.ts";
import changelog from "./changelog.ts";
import common from "./common.ts";
import menu from "./menu.ts";
import namespace from "./namespace.ts";
import nativeApp from "./native.ts";
import nav from "./nav.ts";
import pwa from "./pwa.ts";
import search from "./search.ts";
import settings from "./settings.ts";
import sync from "./sync.ts";

export const en = {
  achievements,
  app,
  changelog,
  common,
  menu,
  namespace,
  native: nativeApp,
  nav,
  pwa,
  search,
  settings,
  sync,
} as const;

export type Catalog = Widen<typeof en>;
