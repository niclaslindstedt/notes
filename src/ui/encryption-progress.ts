import type { MessageKey } from "../i18n/index.ts";
import type { EncryptionProgressStep } from "../storage/useStorageBackend.ts";

// Maps each progress phase the storage layer reports to the catalog string the
// status bars flash. Shared by the storage tab's encryption toggle and the
// full-screen unlock gate so both name the same phase identically. Module-level
// so the record is built once, not per render.
export const STEP_MESSAGE_KEY: Record<EncryptionProgressStep, MessageKey> = {
  reading: "settings.storage.encryptionStepReading",
  derivingKey: "settings.storage.encryptionStepDerivingKey",
  encrypting: "settings.storage.encryptionStepEncrypting",
  decrypting: "settings.storage.encryptionStepDecrypting",
  saving: "settings.storage.encryptionStepSaving",
  finalizing: "settings.storage.encryptionStepFinalizing",
};
