// Mock OpenRouter for end-to-end testing.
//
// Serves pre-generated model output (produced by Claude Sonnet following the production
// extraction prompt) through the OpenAI-compatible surface the real provider calls, so
// the ENTIRE Worker path — /extract → provider → schema parse → validator → claims —
// runs unmodified. The Worker points here via OPENROUTER_BASE_URL.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const OUT_DIR = process.argv[2];
const PORT = Number(process.argv[3] ?? 9099);

const COURSE_KEYS = [
  ["BIO 240", "fake-bio"],
  ["HIS 210", "fake-his"],
  ["MAT 205", "fake-mat"],
  ["ENG 230", "fake-eng"],
  ["PED 110", "fake-ped"],
];

function completion(content, model) {
  return JSON.stringify({
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 5000, completion_tokens: 2000 },
  });
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const parsed = JSON.parse(body || "{}");
      const schemaName = parsed.response_format?.json_schema?.name;
      const text = JSON.stringify(parsed.messages ?? []);

      let content;
      if (schemaName === "syllabus_extraction") {
        const match = COURSE_KEYS.find(([code]) => text.includes(code));
        if (!match) throw new Error("no matching course in request");
        content = readFileSync(`${OUT_DIR}/${match[1]}.output.json`, "utf8");
        console.log(`[mock] extraction -> ${match[1]}`);
      } else if (schemaName === "topic_verdict") {
        content = JSON.stringify({ label: "ALLOW" });
        console.log("[mock] guard -> ALLOW");
      } else if (schemaName === "coach_reply") {
        content = JSON.stringify({
          message:
            "Start with the BIO 240 lab report block — it unlocks the rest of the lab sequence and this is your strongest window.",
          facts: ["The lab report is worth part of the 25% Laboratory Reports category."],
          assumptions: ["You are free until your next commitment."],
          actions: [{ type: "SHOW_WEEK", label: "Show me this week", payload: {} }],
        });
        console.log("[mock] coach -> canned reply");
      } else {
        throw new Error(`unknown schema: ${schemaName}`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(completion(content, parsed.model ?? "mock"));
    } catch (error) {
      console.error("[mock] error:", error.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock] openrouter on 127.0.0.1:${PORT}`));
