/**
 * Client-side PDF text extraction.
 *
 * This runs in the client rather than the Worker for a hard reason: the Cloudflare Workers
 * free plan allows 10ms of CPU per request, and parsing even a short syllabus costs far
 * more than that. Fetch latency does not count toward CPU, so the Worker can happily wait
 * on the model — it just cannot do the parsing itself.
 *
 * It also fits the product: syllabus upload is a desktop task, and the desktop app has a
 * whole machine to spend. The Worker receives page text it can quote against, and never
 * has to touch the PDF bytes.
 *
 * pdf.js is loaded by dynamic import so it stays out of the main bundle — the phone PWA
 * never uploads a syllabus and should not pay ~350 KB for the privilege.
 */

export interface DocumentPage {
  page: number;
  text: string;
}

export interface PdfExtractionResult {
  pages: DocumentPage[];
  pageCount: number;
  /** True when the PDF yielded almost no text, which usually means it is a scan. */
  likelyScanned: boolean;
}

/** Below this many characters across the whole document, assume it is images, not text. */
const SCANNED_TEXT_THRESHOLD = 200;

export async function extractPdfText(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfExtractionResult> {
  const pdfjs = await import("pdfjs-dist");

  // Vite resolves this to a hashed asset URL at build time; pdf.js needs the worker to
  // parse off the main thread, otherwise a long syllabus freezes the window.
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import("pdfjs-dist/build/pdf.worker.mjs?url")
  ).default;

  const data = new Uint8Array(await file.arrayBuffer());
  // We only ever read text, never render, so font handling is pure overhead — and
  // disabling it avoids font fetches the desktop app's CSP would block anyway.
  const loadingTask = pdfjs.getDocument({ data, disableFontFace: true });

  const pages: DocumentPage[] = [];
  let pageCount: number;

  try {
    const document = await loadingTask.promise;
    pageCount = document.numPages;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        pages.push({ page: pageNumber, text: joinTextItems(content.items) });
      } finally {
        page.cleanup();
      }
      onProgress?.(pageNumber, pageCount);
    }
  } finally {
    // Tears down the pdf.js worker; without this each upload leaks one.
    await loadingTask.destroy();
  }

  const totalChars = pages.reduce((sum, p) => sum + p.text.trim().length, 0);

  return { pages, pageCount, likelyScanned: totalChars < SCANNED_TEXT_THRESHOLD };
}

/**
 * Reassembles pdf.js text items into readable lines.
 *
 * pdf.js emits positioned fragments, not lines. Without honoring its end-of-line markers
 * a grading table collapses into one run-on string, which destroys the structure the
 * model needs to read weights and dates correctly.
 */
function joinTextItems(items: unknown[]): string {
  let text = "";

  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) continue;
    const { str, hasEOL } = item as { str: string; hasEOL?: boolean };

    text += str;
    if (hasEOL) {
      text += "\n";
    } else if (str.length > 0 && !str.endsWith(" ")) {
      // Adjacent fragments on the same line are usually separate words.
      text += " ";
    }
  }

  return (
    text
      // Collapse runs of blank lines, but keep single breaks: they carry table structure.
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, "  ")
      .trim()
  );
}
