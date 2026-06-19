// Runtime shims the shared core assumes but React Native doesn't always
// provide. The logic layer under ../../src is otherwise platform-clean: it
// reads `localStorage` / `navigator` only behind `typeof … === "undefined"`
// guards, so the one thing left to supply on Hermes is a `crypto.randomUUID`.

// Installs a spec-compliant `crypto.getRandomValues` onto the global.
import "react-native-get-random-values";

// `crypto.randomUUID` (used by ../../src/domain/note.ts → newNoteId) is not
// guaranteed on Hermes. Derive an RFC 4122 v4 UUID from getRandomValues when
// the runtime doesn't already expose it.
const cryptoObj = globalThis.crypto as Crypto & {
  randomUUID?: () => string;
};

if (typeof cryptoObj.randomUUID !== "function") {
  cryptoObj.randomUUID = (() => {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    // Set the version (4) and variant (10xx) bits.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return (
      hex.slice(0, 4).join("") +
      "-" +
      hex.slice(4, 6).join("") +
      "-" +
      hex.slice(6, 8).join("") +
      "-" +
      hex.slice(8, 10).join("") +
      "-" +
      hex.slice(10, 16).join("")
    );
  }) as Crypto["randomUUID"];
}
