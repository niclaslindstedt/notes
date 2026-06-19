// Native entry point. Polyfills must load before anything that reaches for
// `crypto.randomUUID` (the shared id source in ../../src/domain/note.ts), so
// they are imported first, ahead of the app.
import "./src/polyfills";

import { registerRootComponent } from "expo";

import App from "./src/App";

registerRootComponent(App);
