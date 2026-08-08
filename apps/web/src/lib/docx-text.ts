/**
 * Client-side .docx text extraction.
 *
 * Runs in the client for the same hard reason as the PDF reader: the Cloudflare Workers free
 * plan allows 10ms of CPU per request, and unzipping and parsing a syllabus costs far more.
 *
 * ## Why this exists at all
 *
 * The upload only accepted `application/pdf`, and real students have a mix -- one instructor
 * posts a PDF, the next posts the Word file. A .docx syllabus was simply unusable, and the file
 * picker's own filter hid the reason: the file was greyed out, with nothing on screen saying
 * why or what to do about it.
 *
 * ## Why the structure matters more here than the words
 *
 * A syllabus is mostly tables -- the week-by-week schedule, the grading weights. Word stores a
 * table as nested `w:tbl` / `w:tr` / `w:tc` elements whose text, concatenated naively, becomes
 * one run-on string: "Week 1 Reading due Sept 3 Week 2 Quiz Sept 10". The model then has to
 * guess which date belongs to which row, and it guesses wrong in the way that matters.
 *
 * So rows are emitted as rows, with cells separated by a tab, and the extraction sees the same
 * grid a reader sees. This is the same reasoning as `joinTextItems` in the PDF reader, which
 * honours pdf.js end-of-line markers rather than collapsing everything.
 *
 * `fflate` is loaded by dynamic import so it stays out of the main bundle, as pdf.js is: the
 * phone PWA never uploads a syllabus and should not pay for the ability.
 */

import type { DocumentPage } from "./pdf-text";

export interface DocxExtractionResult {
  pages: DocumentPage[];
  pageCount: number;
  /** Kept for shape-compatibility with the PDF result. A .docx always carries its own text. */
  likelyScanned: boolean;
}

/** The part holding the body text. Word writes this path in every .docx. */
const DOCUMENT_PART = "word/document.xml";

export class DocxError extends Error {}

/**
 * Elements are found by `localName` rather than by namespace or prefix.
 *
 * Word writes `w:body`, but the prefix is a choice the file makes, not a guarantee, so matching
 * on the literal string "w:body" is wrong. The obvious alternative, `getElementsByTagNameNS`, is
 * correct in a browser and simply absent from lighter DOM implementations -- which would leave
 * this file testable only by launching Chromium. `localName` is right everywhere, needs no
 * namespace constant, and survives a document that picks a different prefix.
 */
function descendants(root: Element | Document, name: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((el) => el.localName === name);
}

function children(root: Element, name: string): Element[] {
  return Array.from(root.children).filter((el) => el.localName === name);
}

/**
 * `w:type` on a `w:br`, without assuming the prefix -- or that the parser split it off.
 *
 * Attributes are less consistently namespace-processed than elements: a browser reports
 * localName "type" for `w:type`, while lighter implementations hand back the whole "w:type".
 * Accepting both is two comparisons and removes a difference that would otherwise show up only
 * as page breaks silently not working.
 */
function attribute(el: Element, name: string): string | null {
  const suffix = `:${name}`;
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === name || attr.name === name || attr.name.endsWith(suffix)) {
      return attr.value;
    }
  }
  return null;
}

export async function extractDocxText(file: File): Promise<DocxExtractionResult> {
  const { unzipSync } = await import("fflate");

  const bytes = new Uint8Array(await file.arrayBuffer());

  // The old binary .doc is not a zip at all. Caught here so it produces a sentence a student
  // can act on rather than a decompression error from three libraries down.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new DocxError(
      "That is not a .docx file. If it is an older .doc, open it in Word and save it as .docx or PDF.",
    );
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    // Only the body part: a syllabus with images would otherwise inflate every one of them
    // into memory for nothing.
    unzipped = unzipSync(bytes, { filter: (f) => f.name === DOCUMENT_PART });
  } catch (cause) {
    throw new DocxError("That .docx could not be opened -- it may be damaged.", { cause });
  }

  const part = unzipped[DOCUMENT_PART];
  if (!part) throw new DocxError("That .docx has no document body to read.");

  const xml = new TextDecoder().decode(part);
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length > 0) {
    throw new DocxError("That .docx could not be read -- its contents did not parse.");
  }

  const body = descendants(parsed, "body")[0];
  if (!body) throw new DocxError("That .docx has no document body to read.");

  const pages = splitIntoPages(readBlocks(body));

  return {
    pages,
    pageCount: pages.length,
    likelyScanned: false,
  };
}

/**
 * Walks the body's top-level blocks, turning each into a line of text.
 *
 * Only direct children, and only paragraphs and tables: recursing into everything would emit a
 * table's paragraphs twice, once inside the row and once on their own.
 */
function readBlocks(body: Element): string[] {
  const lines: string[] = [];

  for (const child of Array.from(body.children)) {
    if (child.localName === "p") {
      lines.push(paragraphText(child));
    } else if (child.localName === "tbl") {
      lines.push(...tableLines(child));
    }
  }

  return lines;
}

/**
 * One table row per line, cells separated by tabs.
 *
 * The whole point of the file. A syllabus schedule read as prose loses which date belongs to
 * which week, and that error is invisible -- it produces a plausible wrong date rather than a
 * missing one.
 */
function tableLines(table: Element): string[] {
  const lines: string[] = [];

  for (const row of descendants(table, "tr")) {
    // Only cells belonging to this row: a nested table would otherwise pull its cells up.
    const cells = children(row, "tc");
    const texts = cells.map((cell) =>
      descendants(cell, "p")
        .map(paragraphText)
        .filter((t) => t.length > 0)
        .join(" ")
        .trim(),
    );
    if (texts.some((t) => t.length > 0)) lines.push(texts.join("\t"));
  }

  return lines;
}

/**
 * The text of one paragraph, honouring the things Word stores as elements rather than characters.
 *
 * `w:tab` and `w:br` carry layout that a syllabus uses to separate a due date from its
 * assignment. Dropping them runs the two together.
 */
function paragraphText(paragraph: Element): string {
  let text = "";

  for (const node of Array.from(paragraph.getElementsByTagName("*"))) {
    switch (node.localName) {
      case "t":
        text += node.textContent ?? "";
        break;
      case "tab":
        text += "\t";
        break;
      case "br":
        // A page break is kept as a marker and turned into a page boundary afterwards.
        text += attribute(node, "type") === "page" ? PAGE_BREAK : "\n";
        break;
      // Deleted text (`w:delText`) is deliberately not read: a syllabus edited with tracked
      // changes would otherwise contribute the old date and the new one, both as fact.
      default:
        break;
    }
  }

  return text.replace(/[ \t]+$/gm, "").trim();
}

/** Private-use character, so it cannot collide with anything a syllabus actually contains. */
const PAGE_BREAK = "\uE000";

/**
 * Splits on explicit page breaks, or returns the whole document as one page.
 *
 * Word does not store where automatic pagination falls -- that is decided when rendering, by
 * the printer and the font -- so page numbers here are honest only where the author forced a
 * break. Every claim the model makes carries a quoted excerpt as well as a page, and the quote
 * is what the evidence check actually verifies, so a document that is all "page 1" still gets
 * checked line by line.
 */
function splitIntoPages(lines: string[]): DocumentPage[] {
  const pages: DocumentPage[] = [];
  let current: string[] = [];

  const push = () => {
    const text = tidy(current.join("\n"));
    // A trailing break must not add an empty final page.
    if (text.length > 0) pages.push({ page: pages.length + 1, text });
    current = [];
  };

  for (const line of lines) {
    if (!line.includes(PAGE_BREAK)) {
      current.push(line);
      continue;
    }
    const parts = line.split(PAGE_BREAK);
    parts.forEach((part, index) => {
      current.push(part);
      if (index < parts.length - 1) push();
    });
  }
  push();

  return pages.length > 0 ? pages : [{ page: 1, text: "" }];
}

/** Matches the PDF reader's tidying, so both produce text of the same shape for the model. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
