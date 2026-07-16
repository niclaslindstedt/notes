// Native entry point. The app is a thin WebView shell around the compiled web
// PWA embedded in the binary — see native/README.md and WebViewHost.tsx.
import { registerRootComponent } from "expo";

import WebViewHost from "./src/WebViewHost";

registerRootComponent(WebViewHost);
