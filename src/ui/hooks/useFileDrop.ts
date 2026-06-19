import { useCallback, useEffect, useRef, useState } from "react";

import { isImportableFilename } from "../../domain/import.ts";

// Whole-window file drag-and-drop, for importing markdown files by dropping
// them anywhere on the app. Listens at the document level so the entire shell
// is a drop target, surfaces a `dragging` flag while a file is hovering over
// the window (so the UI can show a drop overlay), and on drop reads every
// importable file's text and hands the (name, text) pairs back.
//
// Deliberately a desktop interaction — dragging a file from the OS onto the
// page is a pointer gesture mobile browsers don't offer — so the caller gates
// it off on touch devices via `enabled`.

export type DroppedFile = { name: string; text: string };

type Options = {
  // When false the listeners are not attached at all — used to stand the whole
  // feature down on touch devices, or while a modal owns the screen.
  enabled?: boolean;
  // Called with the importable files read from a drop, in drop order. Never
  // called with an empty array (a drop carrying no importable file is ignored).
  onFiles: (files: DroppedFile[]) => void;
};

// A drag is "carrying files" when its data-transfer advertises the `Files`
// type. This filters out in-page drags (selecting text, dragging a note card)
// so the overlay only appears for a genuine file-from-the-OS drag.
function carriesFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}

export function useFileDrop({ enabled = true, onFiles }: Options): {
  dragging: boolean;
} {
  const [dragging, setDragging] = useState(false);

  // `dragenter` / `dragleave` fire for every element the cursor crosses, so a
  // single move over a child looks like leave-then-enter. Count nested enters
  // and only drop the overlay when the count returns to zero (the cursor has
  // truly left the window).
  const depth = useRef(0);

  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  const reset = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }

    const onDragEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // Calling preventDefault on dragover is what tells the browser this is a
      // valid drop target — without it the drop never fires and the OS shows a
      // "not allowed" cursor.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      reset();
      const list = e.dataTransfer?.files;
      if (!list || list.length === 0) return;
      const files = Array.from(list).filter((f) =>
        isImportableFilename(f.name),
      );
      if (files.length === 0) return;
      // Read every file in parallel, then deliver them in their original drop
      // order so the imported notes land in a predictable sequence.
      void Promise.all(
        files.map(async (f) => ({ name: f.name, text: await f.text() })),
      ).then((read) => onFilesRef.current(read));
    };

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);

    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [enabled, reset]);

  return { dragging };
}
