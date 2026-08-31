import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_HELP_PROMPT, appHelpSignal } from "./app-help.js";
import { buildCoachSystemPrompt } from "./coach.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Whether a component actually *renders* this text, rather than merely containing it.
 *
 * Two weaker checks were tried first and both passed a fault they had to catch. A plain
 * substring search accepts an invented "Remove" button on the strength of the tooltip "Remove
 * the recorded score". Matching quoted text as well accepts a label that has been renamed on
 * screen but is still quoted in the file's own doc comment -- which is exactly the state a
 * drifting prompt is in. So comments come out first, and what is left has to render the label:
 * JSX text between tags, or a string literal in code.
 */
function rendersLabel(source: string, label: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`>\\s*${escaped}\\s*<|"${escaped}"`).test(code);
}

/**
 * The failure this guards is the worst kind of help: confident and wrong.
 *
 * A coach that tells a student to press "Remove" when the button says "Delete" sends them
 * hunting through a screen that does not have it, and what they conclude is that the app is
 * broken -- not that the coach made it up. So every label the prompt quotes is checked against
 * the component that renders it. Rename a button without updating the prompt and this fails,
 * which is the whole point: the prompt is documentation of a UI it cannot see.
 *
 * It reads across packages on purpose. The alternative -- trusting a hand-written prompt to stay
 * in step with a React tree nobody diffs it against -- is how the coach ends up describing last
 * quarter's interface.
 */
describe("what the coach says about the app is actually on screen", () => {
  const screens: { file: string; labels: string[] }[] = [
    {
      file: "apps/web/src/components/Tables.tsx",
      labels: [
        "Not doing it",
        "Put back",
        "Delete",
        "Handed in",
        "Not yet",
        "Show finished and canceled too",
        "Add an assignment",
        "end of day assumed",
      ],
    },
    {
      file: "apps/web/src/components/Today.tsx",
      labels: ["Not now", "Mark done", "Needs more time", "Skip it", "Rather not say"],
    },
    { file: "apps/web/src/components/EffortSurvey.tsx", labels: ["Skip this one"] },
  ];

  for (const screen of screens) {
    for (const label of screen.labels) {
      it(`"${label}" is rendered by ${screen.file.split("/").pop()}`, () => {
        expect(APP_HELP_PROMPT).toContain(label);
        expect(rendersLabel(read(screen.file), label)).toBe(true);
      });
    }
  }

  it("quotes no control the screens do not have", () => {
    // The other direction, and the one that catches an invented button: every quoted string in
    // the prompt has to exist somewhere in the three screens it describes. Rename a control in
    // the prompt alone -- "Remove" for "Not doing it" -- and this is what fails.
    const rendered = screens.map((s) => read(s.file)).join("\n");
    const quoted = [...APP_HELP_PROMPT.matchAll(/"([^"\n]{2,40})"/g)].map((m) => m[1]!);

    expect(quoted.length).toBeGreaterThan(10);
    expect(quoted.filter((label) => !rendersLabel(rendered, label))).toEqual([]);
  });

  it("names the one control that cannot be undone, and says so", () => {
    // The single most expensive thing to get wrong: a student reaching for Delete when they
    // meant "not this term". Both halves have to be in the prompt -- that it is irreversible,
    // and what to use instead.
    expect(APP_HELP_PROMPT).toMatch(/cannot be undone/i);
    expect(APP_HELP_PROMPT).toMatch(/"Not doing it", not this/);
  });

  it("keeps declining a block, an assignment and a question apart", () => {
    expect(APP_HELP_PROMPT).toMatch(/decline a \*question the app asked\*/i);
    expect(APP_HELP_PROMPT).toMatch(/never an assignment or a block/i);
  });

  it("says a due date carries a time of day", () => {
    expect(APP_HELP_PROMPT).toMatch(/time of day/i);
    expect(APP_HELP_PROMPT).toMatch(/end of day assumed/);
  });

  it("repeats the promise that nothing declined is counted", () => {
    // docs/01 §3. A student asking "what does not now do?" is usually asking "does this go on
    // my record?", and the answer they need is in the same breath as the mechanics.
    expect(APP_HELP_PROMPT).toMatch(/counted, tallied or\s+held against them/i);
  });
});

describe("the coach carries it, in every theme", () => {
  for (const theme of ["plain", "quest", "mission"] as const) {
    it(`${theme}: the prompt includes the app section and keeps labels literal`, () => {
      const prompt = buildCoachSystemPrompt(theme);
      expect(prompt).toContain(APP_HELP_PROMPT);
      expect(prompt).toMatch(/Button labels are never themed/);
      // The grounding rule is otherwise absolute ("if it is not in the context, you do not know
      // it"), and app facts are not in the plan context. Without the carve-out the coach has
      // been told both to answer and that it does not know.
      expect(prompt).toMatch(/The one exception is the app itself/);
    });
  }

  it("does not smuggle theme vocabulary into the plain prompt", () => {
    const plain = buildCoachSystemPrompt("plain");
    for (const word of ["questline", "campaign", "encounter", "sortie", "handler"]) {
      expect(plain).not.toContain(word);
    }
  });
});

describe("appHelpSignal", () => {
  it("is certain when the message names something only this app has", () => {
    expect(appHelpSignal("what does the delete button do")).toBe("app");
    expect(appHelpSignal("what does not doing it do")).toBe("app");
    expect(appHelpSignal("what does end of day assumed mean")).toBe("app");
  });

  it("is unsure when a control's name is also ordinary English", () => {
    // Second review pass: "put back" and "mark done" are buttons here and sentences everywhere
    // else, so on their own they were allowing coursework questions deterministically.
    expect(appHelpSignal("How do I put back an item I popped from a stack?")).toBe("ambiguous");
    expect(appHelpSignal("How do I mark done a node in my traversal?")).toBe("ambiguous");
    expect(appHelpSignal("what does handed in mean in my rubric")).toBe("ambiguous");
  });

  it("is certain again once the message says it is about the interface", () => {
    // Pressing, clicking and naming a button are what make those same phrases unambiguous.
    expect(appHelpSignal("what happens if I press handed in")).toBe("app");
    expect(appHelpSignal("where do I put back something I marked not doing it")).toBe("app");
  });

  it("is unsure when only the interface word is there", () => {
    // Third review pass: `tab`, `click` and `tap` were settling it alone, so "what is a tab
    // character in Python?" never reached a model.
    expect(appHelpSignal("What is a tab character in Python?")).toBe("ambiguous");
    expect(appHelpSignal("What does click mean in JavaScript?")).toBe("ambiguous");
  });

  it("holds back the coursework regexes for a real app question with no control named", () => {
    // The same bug's other half: `explain the` is a do-my-work pattern, so this was refused as a
    // request to explain a reading. Ambiguous is what keeps it from being refused outright.
    expect(appHelpSignal("explain the assignments tab")).toBe("ambiguous");
  });

  it("is unsure when the only app word is one a course could own", () => {
    // Still app-shaped, so the do-my-work regexes are held back and a model decides.
    expect(appHelpSignal("what does skip mean?")).toBe("ambiguous");
    expect(appHelpSignal("explain the difference between skip and delete")).toBe("ambiguous");
    expect(appHelpSignal("How do I delete a node from a binary tree?")).toBe("ambiguous");
  });

  it("does not claim a coursework question", () => {
    expect(appHelpSignal("explain the chapter to me")).toBe("none");
    expect(appHelpSignal("what does this passage mean")).toBe("none");
    expect(appHelpSignal("summarize the reading")).toBe("none");
  });

  it("ignores an app word outside a question", () => {
    // A statement, not a question about the interface: the planner should handle it as planning.
    expect(appHelpSignal("I skipped my reading yesterday")).toBe("none");
  });
});
