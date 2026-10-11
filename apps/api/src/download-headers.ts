/**
 * Response headers for streaming a stored document back to its owner.
 *
 * The stored MIME type is whatever the uploading client declared, so it is not trusted to decide
 * how a browser renders the bytes. Only types that are safe to display inline -- they cannot run
 * script in this origin -- are served as themselves; anything else (including the .docx the
 * upload route accepts, and any legacy row) goes out as an opaque attachment. `nosniff` stops the
 * browser second-guessing the declared type into something executable.
 *
 * The web client reads the bytes with fetch and re-types them from the document row, so the
 * header it receives here does not change what it can parse.
 */

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export function downloadHeaders(mimeType: string, filename: string): Record<string, string> {
  const type = mimeType.trim().toLowerCase();
  const inline = INLINE_TYPES.has(type);
  // Filenames are sanitized on upload; strip quotes and line breaks again so the header is safe
  // even for a row written before that sanitizing existed.
  const safeName = filename.replace(/[\r\n"\\]/g, "") || "download";
  return {
    "Content-Type": inline ? type : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}
