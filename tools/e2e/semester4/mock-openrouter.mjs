// Mock OpenRouter for the semester-4 real-syllabus run.
//
// Serves extraction JSON authored from the real page text of four genuine Spring 2023
// syllabi, through the OpenAI-compatible surface the production provider calls. The Worker
// points here via OPENROUTER_BASE_URL, so the ENTIRE path downstream of the model runs
// unmodified: schema parse, validator, evidence check, date resolution, recurrence
// expansion, claim persistence, review, confirm, scheduling.
//
// What this tests: everything after the model, against real documents.
// What it does not test: the production model's own reading of those documents.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const DIR = new URL(".", import.meta.url).pathname;
const PORT = Number(process.argv[2] ?? 9099);

/** Matched against the request body, which carries the course name the student filed under. */
const COURSES = [
  ["Math 104", "richland_math104"],
  ["COSC 1315", "tamut_cosc1315"],
  ["GEOG 062", "unc_geog062"],
  ["Family Law", "wsu_familylaw"],
];

const completion = (content, model) =>
  JSON.stringify({
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 8000, completion_tokens: 3000 },
  });

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const parsed = JSON.parse(body || "{}");
      const schema = parsed.response_format?.json_schema?.name;
      const text = JSON.stringify(parsed.messages ?? []);
      let content;

      if (schema === "syllabus_extraction") {
        const match = COURSES.find(([code]) => text.includes(code));
        if (!match) throw new Error("no matching course in request");
        content = readFileSync(`${DIR}${match[1]}.output.json`, "utf8");
        console.log(`[mock] extraction -> ${match[1]}`);
      } else if (schema === "topic_verdict") {
        content = JSON.stringify({ label: "ALLOW" });
      } else {
        content = "This run does not exercise the coach.";
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(completion(content, parsed.model ?? "mock"));
    } catch (e) {
      console.error("[mock]", e.message);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  });
}).listen(PORT, () => console.log(`[mock] listening on ${PORT}`));
