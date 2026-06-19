// Composed Swedish catalog. Each per-namespace file is typed against its
// English counterpart; the top-level `: Catalog` annotation here is the
// belt-and-braces safety net against an accidentally-dropped namespace.

import type { Catalog } from "../en/index.ts";

import achievements from "./achievements.ts";
import app from "./app.ts";
import changelog from "./changelog.ts";
import common from "./common.ts";
import menu from "./menu.ts";
import namespace from "./namespace.ts";
import nativeApp from "./native.ts";
import nav from "./nav.ts";
import pwa from "./pwa.ts";
import settings from "./settings.ts";
import sync from "./sync.ts";

export const sv: Catalog = {
  achievements,
  app,
  changelog,
  common,
  menu,
  namespace,
  native: nativeApp,
  nav,
  pwa,
  settings,
  sync,
};
