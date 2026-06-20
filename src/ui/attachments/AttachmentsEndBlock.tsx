import { relocatedAttachments } from "../../domain/attachment.ts";
import { useT } from "../../i18n/index.ts";
import { useAttachmentsContext } from "./context.ts";
import { FileAttachment } from "./FileAttachment.tsx";
import { InlineImage } from "./InlineImage.tsx";

// The collected attachments block rendered at the foot of a note when the
// editor settings place images and/or files "at the end" rather than inline.
// It reads the note's attachments and the placement off the surrounding
// `AttachmentsProvider`, renders the relocated images as a row of thumbnails
// (opening the same viewer an inline image would) and the relocated files as a
// stack of chips. Nothing renders when neither kind is relocated, so the block
// is inert under the default inline placement.

export function AttachmentsEndBlock() {
  const t = useT();
  const ctx = useAttachmentsContext();
  if (!ctx) return null;
  const { images, files } = relocatedAttachments(
    ctx.attachments,
    ctx.placement,
  );
  if (images.length === 0 && files.length === 0) return null;
  return (
    <div className="mt-4 border-t border-line pt-3" contentEditable={false}>
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {t("app.attachments")}
      </p>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <InlineImage
              key={a.filename}
              attachment={a}
              srcOffset={0}
              onOpen={ctx.open}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div
          className={`flex flex-col items-start gap-1 ${images.length > 0 ? "mt-2" : ""}`}
        >
          {files.map((a) => (
            <FileAttachment key={a.filename} attachment={a} srcOffset={0} />
          ))}
        </div>
      )}
    </div>
  );
}
