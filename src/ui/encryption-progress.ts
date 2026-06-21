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

// The unlock gate brackets a single `load()` with derivingKey → decrypting →
// finalizing, so it names those three phases in the user's own terms ("checking
// your passphrase", "unlocking your notes") rather than reusing the generic
// encryption-toggle copy. The remaining phases never fire during unlock but are
// mapped through for type completeness.
export const UNLOCK_STEP_MESSAGE_KEY: Record<
  EncryptionProgressStep,
  MessageKey
> = {
  ...STEP_MESSAGE_KEY,
  derivingKey: "settings.unlock.stepDerivingKey",
  decrypting: "settings.unlock.stepDecrypting",
  finalizing: "settings.unlock.stepFinalizing",
};
