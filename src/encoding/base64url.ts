// Base64URL (RFC 4648 §5) encode/decode over raw bytes, used by the OAuth
// PKCE flow (`storage/oauth-pkce.ts`). The implementation lives in
// @niclaslindstedt/oss-framework; this shim keeps the app's historical
// import path.
export {
  toBase64Url,
  fromBase64Url,
} from "@niclaslindstedt/oss-framework/storage";
