import { useState, type FormEvent } from "react";

import type { BackendId } from "../../storage/backend-preference.ts";
import type { UseStorageBackend } from "../../storage/useStorageBackend.ts";
import { ShieldIcon } from "../icons.tsx";
import { Button } from "../form/Button.tsx";
import { Section } from "./shared.tsx";

// Storage settings: pick the backend that persists the notes (this device /
// local folder / Dropbox / Google Drive) and toggle at-rest encryption.
// Ported from checklist's storage tab, adapted to notes' account-less,
// single-document model and inlined English strings (notes has no i18n layer).

type Props = {
  storage: UseStorageBackend;
};

export function StorageSection({ storage }: Props) {
  const {
    backend,
    dropboxConfigured,
    gdriveConfigured,
    dropboxConnected,
    gdriveConnected,
    folderAvailable,
    folderConnected,
    folderReconnectNeeded,
    encryption,
    selectBrowser,
    connectFolder,
    reconnectFolder,
    disconnectFolder,
    connectDropbox,
    disconnectDropbox,
    connectGdrive,
    disconnectGdrive,
    enableEncryption,
    disableEncryption,
  } = storage;

  const [gdriveError, setGdriveError] = useState<string | null>(null);

  const backendOptions: {
    value: BackendId;
    label: string;
    disabled?: boolean;
  }[] = [
    { value: "browser", label: "This device" },
    { value: "folder", label: "Local folder", disabled: !folderAvailable },
    { value: "dropbox", label: "Dropbox", disabled: !dropboxConfigured },
    { value: "gdrive", label: "Google Drive", disabled: !gdriveConfigured },
  ];

  const connectGdriveWithCapture = async () => {
    setGdriveError(null);
    try {
      await connectGdrive();
    } catch (err) {
      setGdriveError(err instanceof Error ? err.message : String(err));
    }
  };

  const onPickBackend = (next: BackendId) => {
    setGdriveError(null);
    if (next === backend) return;
    if (next === "browser") selectBrowser();
    else if (next === "folder") void connectFolder();
    else if (next === "dropbox") connectDropbox();
    else void connectGdriveWithCapture();
  };

  return (
    <>
      <Section title="Where your notes are stored">
        <p className="text-xs text-muted">
          Notes are saved as one markdown file per note. Keep them on this
          device, in a local folder you pick, or in your own cloud — they never
          touch a server of ours.
        </p>
        <div
          role="radiogroup"
          aria-label="Storage backend"
          className="flex flex-wrap gap-2"
        >
          {backendOptions.map((opt) => {
            const active = opt.value === backend;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={opt.disabled}
                onClick={() => onPickBackend(opt.value)}
                className={`cursor-pointer rounded-[var(--radius)] border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "border-accent bg-accent/15 font-bold text-accent"
                    : "border-line bg-surface-2 text-fg hover:bg-surface-3"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {backend === "browser" && (
          <p className="text-xs text-muted">
            Notes live in this browser only. They stay on this device and
            aren&apos;t shared with your other devices.
          </p>
        )}

        {backend === "folder" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {folderReconnectNeeded
                ? "This browser lost access to the folder. Reconnect to keep saving there."
                : folderConnected
                  ? "Your notes are saved as markdown files in the folder you picked."
                  : "Pick a folder to keep your notes in as markdown files."}
            </p>
            <div className="flex items-center gap-2">
              {folderReconnectNeeded ? (
                <Button
                  variant="primary"
                  onClick={() => void reconnectFolder()}
                >
                  Reconnect folder
                </Button>
              ) : folderConnected ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => void disconnectFolder()}
                  >
                    Disconnect
                  </Button>
                  <span className="text-xs text-accent">Connected</span>
                </>
              ) : (
                <Button variant="primary" onClick={() => void connectFolder()}>
                  Choose folder…
                </Button>
              )}
            </div>
          </div>
        )}

        {backend === "dropbox" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {dropboxConnected
                ? "Your notes sync to your Dropbox app folder."
                : "Sign in to keep your notes in your own Dropbox."}
            </p>
            {dropboxConnected ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={disconnectDropbox}>
                  Disconnect
                </Button>
                <span className="text-xs text-accent">Connected</span>
              </div>
            ) : (
              <Button variant="primary" onClick={connectDropbox}>
                Connect
              </Button>
            )}
          </div>
        )}

        {backend === "gdrive" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {gdriveConnected
                ? "Your notes sync to a folder in your Google Drive."
                : "Sign in to keep your notes in your own Google Drive."}
            </p>
            {gdriveConnected ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={disconnectGdrive}>
                  Disconnect
                </Button>
                <span className="text-xs text-accent">Connected</span>
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={() => void connectGdriveWithCapture()}
              >
                Connect
              </Button>
            )}
            {gdriveError && (
              <p
                role="alert"
                className="rounded-[var(--radius)] border border-danger/50 px-2 py-1.5 text-xs break-words text-danger"
              >
                {gdriveError}
              </p>
            )}
          </div>
        )}
      </Section>

      <EncryptionSection
        encryption={encryption}
        onEnable={enableEncryption}
        onDisable={disableEncryption}
      />
    </>
  );
}

function EncryptionSection({
  encryption,
  onEnable,
  onDisable,
}: {
  encryption: "encrypted" | "plaintext";
  onEnable: (password: string) => Promise<void>;
  onDisable: () => Promise<void>;
}) {
  const on = encryption === "encrypted";
  const [setting, setSetting] = useState(false);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitEnable = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (pass.length < 4) {
      setError("Use a passphrase of at least 4 characters.");
      return;
    }
    if (pass !== confirm) {
      setError("The passphrases don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onEnable(pass);
      setSetting(false);
      setPass("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDisable();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";

  return (
    <Section title="Encryption">
      <div className="flex items-start gap-3">
        <ShieldIcon
          className={`mt-0.5 h-5 w-5 ${on ? "text-accent" : "text-muted"}`}
        />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-fg-bright">
            {on ? "Encryption is on" : "Encryption is off"}
          </h3>
          <p className="mt-1 text-xs text-muted">
            Scramble your notes (AES-GCM) with a passphrase before they&apos;re
            saved. The passphrase never leaves this device and can&apos;t be
            recovered — forget it and the notes can&apos;t be read.
          </p>
        </div>
      </div>

      {!on && !setting && (
        <Button variant="primary" onClick={() => setSetting(true)}>
          Turn on encryption
        </Button>
      )}

      {!on && setting && (
        <form onSubmit={submitEnable} className="flex flex-col gap-2">
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Passphrase"
            aria-label="Passphrase"
            className={inputClass}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm passphrase"
            aria-label="Confirm passphrase"
            className={inputClass}
          />
          <p className="text-xs text-danger">
            There is no recovery. If you forget this passphrase your notes
            can&apos;t be read.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              Turn on encryption
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSetting(false);
                setError(null);
                setPass("");
                setConfirm("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {on && (
        <Button variant="danger" onClick={() => void disable()} disabled={busy}>
          Turn off encryption
        </Button>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}
