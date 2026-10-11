import { describe, expect, it } from "vitest";
import { downloadHeaders } from "./download-headers.js";

/**
 * The bug these guard: the download route echoed the client-declared MIME type with
 * `Content-Disposition: inline` and no `nosniff`, so an upload declared as text/html would render
 * as a page in the API's origin.
 */
describe("downloadHeaders", () => {
  it("serves allowlisted types inline, as themselves, with nosniff", () => {
    for (const type of ["application/pdf", "image/png", "image/jpeg", "image/webp"]) {
      const h = downloadHeaders(type, "syllabus.pdf");
      expect(h["Content-Type"]).toBe(type);
      expect(h["Content-Disposition"]).toBe('inline; filename="syllabus.pdf"');
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("forces anything else to an opaque attachment", () => {
    for (const type of ["text/html", "image/svg+xml", "application/javascript", ""]) {
      const h = downloadHeaders(type, "evil.html");
      expect(h["Content-Type"]).toBe("application/octet-stream");
      expect(h["Content-Disposition"]).toBe('attachment; filename="evil.html"');
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("downloads Word documents rather than handing them to the browser", () => {
    const h = downloadHeaders(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "syllabus.docx",
    );
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toMatch(/^attachment;/);
  });

  it("keeps quotes and line breaks out of the filename", () => {
    const h = downloadHeaders("application/pdf", 'a"b\r\nSet-Cookie: x.pdf');
    expect(h["Content-Disposition"]).toBe('inline; filename="abSet-Cookie: x.pdf"');
  });
});
