import { useState, type FormEvent } from "react";

import { useT } from "../../i18n/index.ts";
import { DEFAULT_NEXTCLOUD_FOLDER } from "../../storage/nextcloud/webdav.ts";
import type { NextcloudConnectRequest } from "../../storage/useNextcloudBackend.ts";
import { BusyLabel } from "../BusyLabel.tsx";
import { Button } from "../form/Button.tsx";

// The Nextcloud connect form: server address, login name, app password, and
// the folder the notes land in. The sibling of the notesd pairing form — both
// connect to a server the user runs, so both are a form rather than a
// "Connect" button that hands off to a provider.
//
// The app password gets its own line of copy because it is the whole point of
// the flow: Nextcloud mints a per-client credential under Settings → Security
// that can be revoked on its own, and pasting an account password here would
// hand this device the whole account instead.

const inputClass =
  "rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";

export function NextcloudConnectForm({
  initial,
  onConnect,
}: {
  /** Prefill from the stored connection, when re-entering a rejected password. */
  initial?: { server: string; username: string; folder: string };
  onConnect: (request: NextcloudConnectRequest) => Promise<void>;
}) {
  const t = useT();
  const [server, setServer] = useState(initial?.server ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [appPassword, setAppPassword] = useState("");
  const [folder, setFolder] = useState(initial?.folder ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConnect({ server, username, appPassword, folder });
      setAppPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("settings.storage.nextcloudServer")}
        <input
          type="url"
          inputMode="url"
          autoComplete="url"
          spellcheck={false}
          value={server}
          onInput={(e) => setServer((e.target as HTMLInputElement).value)}
          placeholder={t("settings.storage.nextcloudServerPlaceholder")}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("settings.storage.nextcloudUser")}
        <input
          type="text"
          autoComplete="username"
          spellcheck={false}
          value={username}
          onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
          placeholder={t("settings.storage.nextcloudUserPlaceholder")}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("settings.storage.nextcloudAppPassword")}
        <input
          type="password"
          autoComplete="current-password"
          value={appPassword}
          onInput={(e) => setAppPassword((e.target as HTMLInputElement).value)}
          placeholder={t("settings.storage.nextcloudAppPasswordPlaceholder")}
          className={`${inputClass} font-mono`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("settings.storage.nextcloudFolder")}
        <input
          type="text"
          spellcheck={false}
          value={folder}
          onInput={(e) => setFolder((e.target as HTMLInputElement).value)}
          placeholder={DEFAULT_NEXTCLOUD_FOLDER}
          className={inputClass}
        />
        <span>
          {t("settings.storage.nextcloudFolderHint", {
            fallback: DEFAULT_NEXTCLOUD_FOLDER,
          })}
        </span>
      </label>
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-danger/50 px-2 py-1.5 text-xs break-words text-danger"
        >
          {error}
        </p>
      )}
      <p className="text-xs text-muted">
        {t("settings.storage.nextcloudCorsHint")}
      </p>
      <div>
        <Button variant="primary" type="submit" disabled={busy}>
          <BusyLabel busy={busy}>{t("common.connect")}</BusyLabel>
        </Button>
      </div>
    </form>
  );
}
