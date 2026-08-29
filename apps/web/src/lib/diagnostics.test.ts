import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDiagnosticsForTest,
  dumpDiagnostics,
  installConsoleCapture,
  recordDiagnostic,
} from "./diagnostics";

/** Body lines of a dump, without the context header (which is separated by a blank line). */
function bodyLines(dump: string): string[] {
  const blank = dump.indexOf("\n\n");
  return dump
    .slice(blank + 2)
    .trimEnd()
    .split("\n");
}

afterEach(() => {
  __resetDiagnosticsForTest();
});

describe("the diagnostics ring buffer", () => {
  it("keeps only the last 500 lines, dropping the oldest", () => {
    __resetDiagnosticsForTest();
    for (let i = 0; i < 600; i++) recordDiagnostic("api", `entry ${i}`);

    const lines = bodyLines(dumpDiagnostics());
    expect(lines).toHaveLength(500);
    // The first 100 fell off the front; 100..599 remain, in order.
    expect(lines[0]).toContain("entry 100");
    expect(lines.at(-1)).toContain("entry 599");
  });

  it("records the tag and message, oldest first", () => {
    __resetDiagnosticsForTest();
    recordDiagnostic("api", "GET /api/documents/x/file -> 410");
    recordDiagnostic("api", "GET /api/documents/y/file -> 200");

    const lines = bodyLines(dumpDiagnostics());
    expect(lines[0]).toMatch(/\[api\] GET \/api\/documents\/x\/file -> 410$/);
    expect(lines[1]).toContain("-> 200");
  });

  it("truncates a pathological line instead of letting it swallow the buffer", () => {
    __resetDiagnosticsForTest();
    recordDiagnostic("error", "x".repeat(10_000));

    const lines = bodyLines(dumpDiagnostics());
    expect(lines[0]).toContain("...[truncated]");
    expect(lines[0]!.length).toBeLessThan(2100);
  });

  it("labels an empty buffer rather than dumping a blank body", () => {
    __resetDiagnosticsForTest();
    expect(dumpDiagnostics()).toContain("(no activity recorded)");
  });

  it("stamps the dump with build context so a pasted log names its origin", () => {
    __resetDiagnosticsForTest();
    const dump = dumpDiagnostics();
    expect(dump).toContain("SchoolQuest diagnostics");
    expect(dump).toContain("Version:");
    expect(dump).toContain("Server:");
  });
});

describe("mirroring the console", () => {
  // vi.spyOn would replace the very method installConsoleCapture wraps, bypassing the wrapper --
  // so instead the underlying method is swapped for a fake BEFORE the first install, which is then
  // what the wrapper captures as its "original". This must be the first install in the module for
  // the fake to be picked up (install is idempotent and runs its wrapping only once).
  it("captures console output and still calls the original", () => {
    const fakeOriginal = vi.fn();
    const realError = console.error;
    console.error = fakeOriginal;
    installConsoleCapture();
    __resetDiagnosticsForTest();

    console.error("boom", { code: 410 });

    const lines = bodyLines(dumpDiagnostics());
    expect(lines.at(-1)).toContain("boom");
    expect(lines.at(-1)).toContain('{"code":410}');
    // Delegation: the wrapper still calls through, so devtools output is not swallowed.
    expect(fakeOriginal).toHaveBeenCalledWith("boom", { code: 410 });

    console.error = realError;
  });

  it("is idempotent -- installing twice does not double-record", () => {
    // Guard check: a second install must not wrap the wrapper. If it did, each layer would push and
    // one line would be recorded twice. debug was wrapped by the first install above; call through it.
    installConsoleCapture();
    __resetDiagnosticsForTest();

    console.debug("once");

    const hits = bodyLines(dumpDiagnostics()).filter((l) => l.includes("once"));
    expect(hits).toHaveLength(1);
  });
});
