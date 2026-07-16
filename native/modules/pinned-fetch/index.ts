// JS interface for the `PinnedFetch` native module: an HTTPS request whose
// server certificate is validated against a pinned SPKI SHA-256 fingerprint
// (the `sha256:<base64>` a notesd daemon prints in its QR / config), bypassing
// the system CA store so a self-signed daemon cert is trusted iff its public
// key matches the pin.
//
// This is the native half of `pinnedFetch` in
// `src/platform/native-bridge.ts`; the web app never calls it directly, only
// over the WebView bridge.

import { requireNativeModule } from "expo-modules-core";

export interface PinnedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Request body as base64, or null for bodyless methods (GET/HEAD). */
  bodyBase64: string | null;
  /** Pinned SPKI SHA-256, `sha256:<base64>` or the bare base64 digest. */
  spkiPin: string;
}

export interface PinnedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Response body as base64, or null when empty. */
  bodyBase64: string | null;
}

interface PinnedFetchNativeModule {
  request(request: PinnedRequest): Promise<PinnedResponse>;
}

const PinnedFetch = requireNativeModule<PinnedFetchNativeModule>("PinnedFetch");

/** Reject if the server's SPKI does not match `request.spkiPin`. */
export function pinnedFetch(request: PinnedRequest): Promise<PinnedResponse> {
  return PinnedFetch.request(request);
}
