import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContextMenu } from "@niclaslindstedt/oss-framework/components";

import { unlock } from "../../achievements/bus.ts";
import {
  type Attachment,
  type AttachmentPlacement,
  INLINE_PLACEMENT,
  isImageAttachment,
  referencedAttachments,
} from "../../domain/attachment.ts";
import type { Note } from "../../domain/note.ts";
import { useT } from "../../i18n/index.ts";
import { useFlashMessage } from "../hooks/useFlashMessage.ts";
import { CopyIcon, CutIcon, TrashIcon } from "../icons.tsx";
import { Toast } from "../Toast.tsx";
import { copyImageToClipboard } from "./clipboard.ts";
import { AttachmentsContext, resolveAttachment } from "./context.ts";
import { loadAttachmentData, useAttachmentFetcher } from "./fetch-context.ts";
import { ImageViewer } from "./ImageViewer.tsx";

// Scopes attachment resolution + the full-size viewer to one note's
// attachments. Both the live-preview editor and the read-only note view wrap
// their rendered Markdown in this, so an `![alt](attachments/<file>)` image
// renders as a clickable thumbnail that opens the original and a
// `[file](attachments/<file>)` link renders as a downloadable file chip. Owns
// the viewer overlay's open/close state — tracked as an index into the note's
// *images* (the viewer is an image gallery; file attachments don't open in
// it) so it can step left/right through them, not just the one clicked.
//
// It also owns **which image is selected**, because only one can be: a picture
// in a note answers a click the way a word does, by being picked out, and the
// selection is then what Copy, Cut and Delete act on (see
// `docs/overview.md#image-selection`). Selection only exists where the note can
// actually be changed — `onDelete` / `onCut` given — so in the archive view and
// in a locked note a click opens the picture as it always did.
//
// The keyboard is handled here rather than on the thumbnail, at the document in
// the capture phase, for two reasons: the surface underneath is a
// contenteditable that would otherwise answer Backspace by eating a character,
// and a click on an image inside it leaves focus on the editing host rather
// than on the picture, so there is no element of ours reliably in the key's
// path.

type Props = {
  attachments: readonly Attachment[] | undefined;
  /**
   * The body being rendered — the live source in the editor, the note's own in
   * the read-only view. Given, only the attachments this text actually
   * references are resolvable, shown in the end-of-note block, or reachable in
   * the viewer. A note may legitimately declare one its body no longer links
   * to (the reference was erased and the user kept the file — see
   * `app/use-attachment-erasure.ts`), and that one has nothing to draw.
   */
  body?: string;
  /** The note these attachments belong to, for fetching bytes on demand. */
  note?: Note | null;
  /** Where images / files render — inline (default) or at the note's foot. */
  placement?: AttachmentPlacement;
  /**
   * Delete an image outright: its reference leaves the body and its file leaves
   * the backend, with no question asked (picking Delete *is* the answer).
   * Omitted, the note can't be changed here, so images aren't selectable and a
   * click opens the viewer.
   */
  onDelete?: (filename: string) => void;
  /**
   * Cut an image: its reference leaves the body while the file stays put, so a
   * paste puts it straight back. Omitted, the menu simply has no Cut and
   * Ctrl/Cmd+X falls through to the editor.
   */
  onCut?: (filename: string) => void;
  children: ReactNode;
};

/** Where the action menu is showing, and for which image. */
type MenuState = { filename: string; x: number; y: number };

export function AttachmentsProvider({
  attachments,
  body,
  note = null,
  placement = INLINE_PLACEMENT,
  onDelete,
  onCut,
  children,
}: Props) {
  const t = useT();
  const fetcher = useAttachmentFetcher();
  const list = useMemo(
    () =>
      body === undefined
        ? (attachments ?? [])
        : referencedAttachments(body, attachments),
    [attachments, body],
  );
  // The viewer is an image gallery, so it steps through the images only.
  const images = useMemo(() => list.filter(isImageAttachment), [list]);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const editable = onDelete !== undefined;

  // An image that stopped being part of the note (erased, deleted, undone)
  // must not stay selected — nothing is on screen to show it.
  useEffect(() => {
    if (selected === null) return;
    if (images.some((a) => a.filename === selected)) return;
    setSelected(null);
    setMenu(null);
  }, [images, selected]);

  // Copying is otherwise completely silent — the note doesn't change and
  // nothing moves — so it says so, and says so when the browser refused too.
  const flash = useFlashMessage();
  const say = flash.say;
  const copy = useCallback(
    async (attachment: Attachment): Promise<boolean> => {
      const data = await loadAttachmentData(note, attachment, fetcher);
      const ok = data ? await copyImageToClipboard(attachment, data) : false;
      say(ok ? t("app.imageCopied") : t("app.imageCopyFailed"));
      if (ok) unlock("cutout");
      return ok;
    },
    [note, fetcher, say, t],
  );

  const byName = useCallback(
    (filename: string) => images.find((a) => a.filename === filename) ?? null,
    [images],
  );

  // Read from the document listeners below, which are armed once and must not
  // re-arm on every render of a note.
  const latest = useRef({ selected, copy, byName, onDelete, onCut });
  latest.current = { selected, copy, byName, onDelete, onCut };

  const cut = useCallback(async (filename: string): Promise<void> => {
    const { copy: take, byName: find, onCut: remove } = latest.current;
    const attachment = find(filename);
    if (!attachment || !remove) return;
    // The clipboard is the only copy of the picture a cut leaves behind, so a
    // clipboard that refused the write leaves the note exactly as it is.
    if (!(await take(attachment))) return;
    setSelected(null);
    remove(filename);
  }, []);

  // The keyboard, while an image is selected. Capture-phase at the document so
  // the contenteditable underneath never sees a Backspace meant for a picture.
  useEffect(() => {
    if (!editable) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const filename = latest.current.selected;
      if (filename === null) return;
      if (e.altKey) return;
      const accel = e.metaKey || e.ctrlKey;
      const take = (run: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        run();
      };
      if (e.key === "Escape") return take(() => setSelected(null));
      if (accel && (e.key === "c" || e.key === "C")) {
        const attachment = latest.current.byName(filename);
        if (!attachment) return;
        return take(() => void latest.current.copy(attachment));
      }
      if (accel && (e.key === "x" || e.key === "X")) {
        return take(() => void cut(filename));
      }
      if (!accel && (e.key === "Delete" || e.key === "Backspace")) {
        const remove = latest.current.onDelete;
        if (!remove) return;
        return take(() => {
          setSelected(null);
          remove(filename);
        });
      }
      // Anything else is the user going back to writing: let the key through
      // to the editor, but stop holding the picture.
      if (!accel && e.key.length === 1) setSelected(null);
      if (e.key.startsWith("Arrow") || e.key === "Enter") setSelected(null);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [editable, cut]);

  // A press anywhere that isn't the selected picture drops the selection —
  // including one that lands in the text, which is where the caret is going.
  useEffect(() => {
    if (selected === null) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("[data-attachment-image]") !== null
      ) {
        return;
      }
      setSelected(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [selected]);

  const value = useMemo(
    () => ({
      resolve: (href: string) => resolveAttachment(href, list),
      open: (attachment: Attachment) => {
        const i = images.findIndex((a) => a.filename === attachment.filename);
        // The viewer takes over: Escape belongs to it while it is up, and the
        // picture it is showing is selection enough.
        setSelected(null);
        setViewingIndex(i >= 0 ? i : null);
      },
      selected,
      select: setSelected,
      editable,
      openMenu: (attachment: Attachment, at: { x: number; y: number }) => {
        if (editable) setSelected(attachment.filename);
        // A hold on a touchscreen can reach this twice — the browser's own
        // `contextmenu` and our long press both mean "open the menu", and
        // which arrives first varies by platform. The second one must not move
        // a menu that is already up.
        setMenu((cur) =>
          cur?.filename === attachment.filename
            ? cur
            : { filename: attachment.filename, x: at.x, y: at.y },
        );
      },
      copy,
      attachments: list,
      placement,
      note,
    }),
    [list, images, placement, note, selected, editable, copy],
  );
  const viewing = viewingIndex !== null ? images[viewingIndex] : undefined;
  const menuFor = menu ? byName(menu.filename) : null;
  return (
    <AttachmentsContext.Provider value={value}>
      {children}
      {menu && menuFor && (
        <ContextMenu
          position={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
          ariaLabel={t("app.imageActions")}
          actions={[
            {
              label: t("app.copyImage"),
              icon: <CopyIcon className="h-4 w-4" />,
              onSelect: () => void copy(menuFor),
            },
            ...(onCut
              ? [
                  {
                    label: t("app.cutImage"),
                    icon: <CutIcon className="h-4 w-4" />,
                    onSelect: () => void cut(menuFor.filename),
                  },
                ]
              : []),
            ...(onDelete
              ? [
                  {
                    label: t("app.deleteImage"),
                    icon: <TrashIcon className="h-4 w-4" />,
                    onSelect: () => {
                      setSelected(null);
                      onDelete(menuFor.filename);
                    },
                    danger: true,
                  },
                ]
              : []),
          ]}
        />
      )}
      {flash.message && (
        <Toast
          message={flash.message}
          icon={<CopyIcon className="h-4 w-4 shrink-0 text-muted" />}
        />
      )}
      {viewingIndex !== null && viewing && (
        <ImageViewer
          attachments={images}
          index={viewingIndex}
          onIndexChange={setViewingIndex}
          onClose={() => setViewingIndex(null)}
          note={note}
        />
      )}
    </AttachmentsContext.Provider>
  );
}
