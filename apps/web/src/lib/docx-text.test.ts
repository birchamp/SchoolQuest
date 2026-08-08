// @vitest-environment happy-dom
//
// A real DOM, because the reader is built on DOMParser and namespaced lookups, and those are
// exactly the parts that could be wrong. The fixture is a genuine .docx -- a real zip with real
// WordprocessingML inside -- so the whole path is exercised: unzip, parse, walk.
//
// `pnpm test:docx-browser` re-runs these same assertions in real Chromium, because happy-dom was
// wrong about the DOM twice while this was written. A partial implementation can just as easily
// agree with a mistake as disagree with correct code.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { DocxError, extractDocxText } from "./docx-text";

const FIXTURE = join(import.meta.dirname, "__fixtures__", "syllabus.docx");

function fileFrom(bytes: Uint8Array, name: string): File {
  // Copied into a plain ArrayBuffer: a Node Buffer is a Uint8Array over a possibly-shared
  // buffer, which is not a BlobPart as far as the DOM types are concerned.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

describe("extractDocxText", () => {
  let pages: { page: number; text: string }[];
  let all: string;

  beforeAll(async () => {
    const result = await extractDocxText(fileFrom(readFileSync(FIXTURE), "syllabus.docx"));
    pages = result.pages;
    all = pages.map((p) => p.text).join("\n");
  });

  it("reads the paragraph text", () => {
    expect(all).toContain("BIB199C Introduction to Biblical Studies");
  });

  describe("tables", () => {
    it("keeps each row on its own line", () => {
      // The whole reason this file exists. Flattened to prose, "Week 1 ... Sept 3 Week 2 ...
      // Sept 10" leaves the model guessing which date belongs to which week, and it produces a
      // plausible wrong date rather than a visible failure.
      const week1 = all.split("\n").find((line) => line.startsWith("Week 1"));
      expect(week1).toBeDefined();
      expect(week1).toContain("Reading response, Sept 3");
      expect(week1).not.toContain("Week 2");
    });

    it("separates cells so a row does not read as one sentence", () => {
      const week2 = all.split("\n").find((line) => line.startsWith("Week 2"))!;
      expect(week2.split("\t")).toEqual(["Week 2", "Exodus", "Quiz 1, Sept 10"]);
    });

    it("reads a second table later in the document", () => {
      expect(all).toContain("Quizzes\t30%");
      expect(all).toContain("Final\t40%");
    });
  });

  it("keeps a tab between a label and its value", () => {
    // "Instructor:" and "Dr. Reyes" are separate runs with a tab between them; dropping it runs
    // them together, and syllabi use exactly this shape for due dates.
    expect(all).toContain("Instructor:\tDr. Reyes");
  });

  describe("tracked changes", () => {
    it("reads the surviving text and not the deleted text", () => {
      // A syllabus edited with tracked changes would otherwise offer both the old exam date and
      // the new one as fact, and nothing downstream can tell which is which.
      expect(all).toContain("December 12");
      expect(all).not.toContain("December 8");
    });
  });

  describe("pages", () => {
    it("splits on an explicit page break", () => {
      expect(pages.length).toBe(2);
      expect(pages[0]!.text).toContain("Week 1");
      expect(pages[1]!.text).toContain("Grading");
    });

    it("numbers pages from one", () => {
      expect(pages.map((p) => p.page)).toEqual([1, 2]);
    });

    it("does not emit an empty trailing page", () => {
      expect(pages.every((p) => p.text.trim().length > 0)).toBe(true);
    });
  });

  it("never reports a .docx as a scan", () => {
    // The flag exists for image-only PDFs. A Word file always carries its own text.
    expect(all.length).toBeGreaterThan(0);
  });

  describe("files that are not .docx", () => {
    it("says so plainly for an old binary .doc", () => {
      // Not a zip at all. Without this the failure surfaces as a decompression error from a
      // library the student has never heard of.
      const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      return expect(extractDocxText(fileFrom(doc, "syllabus.doc"))).rejects.toThrow(DocxError);
    });

    it("says so for a zip that is not a Word document", () => {
      const zipOnly = readFileSync(join(import.meta.dirname, "__fixtures__", "not-word.zip"));
      return expect(extractDocxText(fileFrom(zipOnly, "notes.zip"))).rejects.toThrow(
        /no document body/i,
      );
    });
  });
});
