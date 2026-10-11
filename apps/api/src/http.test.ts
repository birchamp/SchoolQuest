import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "wrangler";
import { CLIENT_PROTOCOL, CLIENT_PROTOCOL_HEADER } from "./client-protocol.js";

/**
 * The real Worker, over HTTP, against a real local D1.
 *
 * Every other test in this package calls functions. None of them would notice a route that
 * forgot its ownership join, or a write path that runs twice when a request is retried, because
 * both live in the route handlers -- which nothing exercised short of the browser journey.
 *
 * `createTestHarness` builds the Worker from wrangler.toml exactly as `wrangler dev` does, on a
 * random port with throwaway storage, so it never touches the dev database or ports 8787/5173.
 * Sign-in goes through the same dev-mode magic link the app uses.
 */

let server: TestHarness;

beforeAll(async () => {
  server = createTestHarness({
    workers: [
      {
        configPath: new URL("../wrangler.toml", import.meta.url),
        vars: { DEV_MODE: "true" },
        // Never called: every request here is answered before anything reaches a model.
        secrets: { AUTH_SECRET: "http-test-secret", OPENROUTER_API_KEY: "sk-unused-in-tests" },
      },
    ],
  });
  await server.listen();
  await server.getWorker().applyD1Migrations("DB");
}, 120_000);

afterAll(async () => {
  await server?.close();
});

type Json = Record<string, unknown>;

/** A signed-in client: the bearer token the desktop shell uses, from the dev-mode link. */
async function signIn(email: string) {
  const login = (await (await post("/api/auth/login", { email })).json()) as Json;
  const token = new URL(String(login["devLoginUrl"])).searchParams.get("token");
  const session = (await (await post("/api/auth/callback", { token })).json()) as Json;
  // The app's protocol header too: without it every signed-in request is refused as an old app.
  const auth = {
    Authorization: `Bearer ${String(session["sessionToken"])}`,
    [CLIENT_PROTOCOL_HEADER]: String(CLIENT_PROTOCOL),
  };

  return {
    get: (path: string) => server.fetch(path, { headers: auth }),
    send: (method: string, path: string, body?: unknown) =>
      server.fetch(path, {
        method,
        headers: { ...auth, "Content-Type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      }),
    /**
     * Encoded here rather than passed as FormData: the harness's fetch comes from Miniflare's own
     * copy of undici, which does not recognise Node's FormData and would send "[object FormData]".
     */
    upload: async (path: string, form: FormData) => {
      const encoded = new Response(form);
      return server.fetch(path, {
        method: "POST",
        headers: { ...auth, "Content-Type": encoded.headers.get("Content-Type")! },
        body: await encoded.arrayBuffer(),
      });
    },
  };
}

function post(path: string, body: unknown) {
  return server.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Client = Awaited<ReturnType<typeof signIn>>;

/** A term with a calendar (extraction refuses without one), a course, a work item, a document. */
async function buildTerm(client: Client) {
  const term = (await (
    await client.send("POST", "/api/terms", {
      name: "Fall",
      startDate: "2026-09-01",
      endDate: "2026-12-15",
      calendar: { exceptions: [{ date: "2026-11-26", kind: "no_class", label: "Thanksgiving" }] },
    })
  ).json()) as { term: { id: string } };

  const course = (await (
    await client.send("POST", `/api/terms/${term.term.id}/courses`, { name: "Biology" })
  ).json()) as { course: { id: string } };

  const item = (await (
    await client.send("POST", "/api/work-items", {
      courseId: course.course.id,
      title: "Lab report",
      workType: "lab",
    })
  ).json()) as { workItem: { id: string } };

  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.4\n"], { type: "application/pdf" }), "syllabus.pdf");
  const uploaded = await client.upload(`/api/courses/${course.course.id}/documents`, form);
  const document = (await uploaded.json()) as { document: { id: string } };
  if (!document.document) throw new Error(`upload ${uploaded.status} ${JSON.stringify(document)}`);

  return {
    termId: term.term.id,
    courseId: course.course.id,
    workItemId: item.workItem.id,
    documentId: document.document.id,
  };
}

async function count(table: string, where: string, ...binds: string[]): Promise<number> {
  const env = await server.getWorker<{ DB: D1Database }>().getEnv();
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  return row!.n;
}

describe("ownership over HTTP", () => {
  let a: Client;
  let b: Client;
  let owned: Awaited<ReturnType<typeof buildTerm>>;

  beforeAll(async () => {
    a = await signIn("owner-a@example.com");
    b = await signIn("stranger-b@example.com");
    owned = await buildTerm(a);
  }, 60_000);

  it("lets the owner read their own records", async () => {
    expect((await a.get(`/api/terms/${owned.termId}/snapshot`)).status).toBe(200);
    expect((await a.get(`/api/documents/${owned.documentId}/extraction`)).status).toBe(200);
    expect((await a.get(`/api/documents/${owned.documentId}/file`)).status).toBe(200);
  });

  it("hides another user's term", async () => {
    expect((await b.get(`/api/terms/${owned.termId}/snapshot`)).status).toBe(404);
    expect((await b.send("PATCH", `/api/terms/${owned.termId}`, { name: "Mine" })).status).toBe(
      404,
    );
    expect(
      (await b.send("POST", `/api/terms/${owned.termId}/courses`, { name: "Planted" })).status,
    ).toBe(404);
    expect(await count("terms", "id = ? AND name = 'Fall'", owned.termId)).toBe(1);
    expect(await count("courses", "name = 'Planted'")).toBe(0);
  });

  it("hides another user's course", async () => {
    expect((await b.send("PATCH", `/api/courses/${owned.courseId}`, { name: "Mine" })).status).toBe(
      404,
    );
    expect(
      (
        await b.send("POST", "/api/work-items", {
          courseId: owned.courseId,
          title: "Planted",
          workType: "other",
        })
      ).status,
    ).toBe(404);
    expect((await b.send("DELETE", `/api/courses/${owned.courseId}`)).status).toBe(404);
    expect(await count("courses", "id = ? AND name = 'Biology'", owned.courseId)).toBe(1);
  });

  it("hides another user's work item", async () => {
    expect(
      (await b.send("PATCH", `/api/work-items/${owned.workItemId}`, { title: "Mine" })).status,
    ).toBe(404);
    expect((await b.send("DELETE", `/api/work-items/${owned.workItemId}`)).status).toBe(404);
    expect(await count("work_items", "id = ? AND title = 'Lab report'", owned.workItemId)).toBe(1);
  });

  it("hides another user's document", async () => {
    const id = owned.documentId;
    expect((await b.get(`/api/documents/${id}/file`)).status).toBe(404);
    expect((await b.get(`/api/documents/${id}/extraction`)).status).toBe(404);
    expect(
      (await b.send("POST", `/api/documents/${id}/extract`, { pages: [{ page: 1, text: "x" }] }))
        .status,
    ).toBe(404);
    expect(
      (await b.send("POST", `/api/documents/${id}/extraction/confirm`, { acceptedClaimIds: [] }))
        .status,
    ).toBe(404);
    expect((await b.send("DELETE", `/api/documents/${id}`)).status).toBe(404);
    expect(await count("source_documents", "id = ?", id)).toBe(1);
  });
});

/**
 * One read and one write per route file that used to be routes/terms.ts (issue #35), as the owner
 * and as a stranger. The split moved every handler and its ownership check; this is what says each
 * file is still mounted, still at its old path, and still asks whose record it is.
 */
describe("split route files, owner and stranger", () => {
  let a: Client;
  let b: Client;
  let owned: Awaited<ReturnType<typeof buildTerm>>;

  beforeAll(async () => {
    a = await signIn("split-owner@example.com");
    b = await signIn("split-stranger@example.com");
    owned = await buildTerm(a);
  }, 60_000);

  /** The owner gets `ok`; the stranger, sending the identical request, gets 404. */
  async function both(method: string, path: string, ok: number, body?: unknown) {
    const send = (client: Client) =>
      method === "GET" ? client.get(path) : client.send(method, path, body);
    const stranger = await send(b);
    const owner = await send(a);
    expect({ path, owner: owner.status, stranger: stranger.status }).toEqual({
      path,
      owner: ok,
      stranger: 404,
    });
    return (await owner.json()) as Json;
  }

  it("routes/terms.ts", async () => {
    await both("GET", `/api/terms/${owned.termId}/readiness`, 200);
    await both("PATCH", `/api/terms/${owned.termId}`, 200, { name: "Fall (renamed)" });
    await both("POST", `/api/terms/${owned.termId}/archive`, 200);
    await both("POST", `/api/terms/${owned.termId}/unarchive`, 200);
  });

  it("routes/questions.ts", async () => {
    await both("GET", `/api/terms/${owned.termId}/open-questions`, 200);
    await both("GET", `/api/terms/${owned.termId}/effort-survey`, 200);
    await both("POST", `/api/terms/${owned.termId}/effort-answers`, 200, {
      answers: [{ questionId: "no-such-question", minutes: 30 }],
    });
  });

  it("routes/calendar.ts", async () => {
    const calendar = await both("GET", `/api/terms/${owned.termId}/calendar`, 200);
    expect(calendar["startDate"]).toBe("2026-09-01");
    // The paste needs a model, so only the ownership refusal is exercised here.
    expect(
      (await b.send("POST", `/api/terms/${owned.termId}/calendar/paste`, { text: "x".repeat(40) }))
        .status,
    ).toBe(404);
  });

  it("routes/courses.ts", async () => {
    const made = await both("POST", `/api/terms/${owned.termId}/courses`, 201, {
      name: "Chemistry",
    });
    const courseId = (made["course"] as { id: string }).id;
    await both("PATCH", `/api/courses/${courseId}`, 200, { code: "CHEM 101" });
    await both("PUT", `/api/courses/${courseId}/meeting-patterns`, 200, {
      patterns: [{ daysOfWeek: [2, 4], startTime: "09:00", endTime: "10:15" }],
    });
    await both("PUT", `/api/courses/${courseId}/grading`, 200, {
      categories: [{ name: "Exams", weightPercent: 60 }],
    });
    await both("POST", `/api/courses/${courseId}/reset-academics`, 200);
    await both("DELETE", `/api/courses/${courseId}`, 200);
  });

  it("routes/commitments.ts", async () => {
    const made = await both("POST", `/api/terms/${owned.termId}/commitments`, 201, {
      title: "Shift",
      commitmentType: "work",
      daysOfWeek: [5],
      startTime: "17:00",
      endTime: "21:00",
    });
    const id = (made["commitment"] as { id: string }).id;
    await both("PATCH", `/api/commitments/${id}`, 200, { startTime: "18:00" });
    await both("PUT", `/api/terms/${owned.termId}/availability-rules`, 200, {
      rules: [{ dayOfWeek: 1, startTime: "13:00", endTime: "17:00" }],
    });
    await both("DELETE", `/api/commitments/${id}`, 200);
  });

  it("routes/work-items.ts", async () => {
    const made = await both("POST", "/api/work-items", 201, {
      courseId: owned.courseId,
      title: "Term paper",
      workType: "paper",
      estimatedMinutes: 600,
    });
    const id = (made["workItem"] as { id: string }).id;
    await both("PATCH", `/api/work-items/${id}`, 200, { title: "Term paper (draft)" });
    await both("GET", `/api/work-items/${id}/stage-proposal`, 200);
    await both("POST", `/api/work-items/${id}/dependencies`, 201, {
      predecessorWorkItemId: owned.workItemId,
    });
    await both("POST", `/api/work-items/${id}/stages`, 201, {
      stages: [{ title: "Outline", estimatedMinutes: 60 }],
    });
    await both("DELETE", `/api/work-items/${id}`, 200);
  });

  it("routes/grades.ts", async () => {
    await both("PUT", `/api/work-items/${owned.workItemId}/grade`, 201, {
      pointsEarned: 8,
      pointsPossible: 10,
    });
    await both("DELETE", `/api/work-items/${owned.workItemId}/grade`, 200);
  });

  it("the routes that now share db/ownership.ts", async () => {
    await both("GET", `/api/courses/${owned.courseId}/documents`, 200);
    expect(
      (
        await b.send("PATCH", "/api/extraction-claims/claim_nobody_has", {
          reviewStatus: "rejected",
        })
      ).status,
    ).toBe(404);
    expect((await b.send("POST", "/api/work-sessions/session_nobody_has/start")).status).toBe(404);
    expect(
      (await b.send("POST", "/api/work-sessions/session_nobody_has/interrupted", { title: "x" }))
        .status,
    ).toBe(404);
  });
});

/**
 * What an unreadable stored JSON column does (lib/json-column.ts): a screen that only shows the
 * value falls back, and a route that is about to act on it refuses rather than writing defaults.
 */
describe("unreadable stored JSON", () => {
  let a: Client;
  let owned: Awaited<ReturnType<typeof buildTerm>>;

  beforeAll(async () => {
    a = await signIn("corrupt-json@example.com");
    owned = await buildTerm(a);
    const env = await server.getWorker<{ DB: D1Database }>().getEnv();
    await env.DB.prepare("UPDATE terms SET calendar_json = ? WHERE id = ?")
      .bind('{"exceptions": [', owned.termId)
      .run();
    await env.DB.prepare(
      "INSERT INTO extraction_claims (id, source_document_id, claim_type, payload_json, review_status) VALUES (?, ?, 'assignment', ?, 'pending')",
    )
      .bind("claim_corrupt", owned.documentId, "not json at all")
      .run();
  }, 60_000);

  it("falls back where the value is only displayed", async () => {
    const list = await a.get("/api/terms");
    expect(list.status).toBe(200);
    const terms = ((await list.json()) as { terms: { id: string; calendar: { exceptions: [] } }[] })
      .terms;
    expect(terms.find((t) => t.id === owned.termId)?.calendar.exceptions).toEqual([]);

    expect((await a.get(`/api/terms/${owned.termId}/calendar`)).status).toBe(200);
    const readiness = await a.get(`/api/terms/${owned.termId}/readiness`);
    expect(readiness.status).toBe(200);
    expect(((await readiness.json()) as Json)["calendarEntries"]).toBe(0);

    const review = await a.get(`/api/documents/${owned.documentId}/extraction`);
    expect(review.status).toBe(200);
    const claims = ((await review.json()) as { claims: { id: string; payload: unknown }[] }).claims;
    expect(claims.find((claim) => claim.id === "claim_corrupt")?.payload).toEqual({});
  });

  it("refuses where the value would be merged or promoted", async () => {
    const merge = await a.send("PATCH", `/api/terms/${owned.termId}`, {
      calendar: { exceptions: [] },
    });
    expect(merge.status).toBe(500);
    expect(
      await count("terms", "id = ? AND calendar_json = ?", owned.termId, '{"exceptions": ['),
    ).toBe(1);

    const confirm = await a.send("POST", `/api/documents/${owned.documentId}/extraction/confirm`, {
      acceptedClaimIds: ["claim_corrupt"],
    });
    expect(confirm.status).toBe(500);
    expect(
      await count("extraction_claims", "id = ? AND review_status = 'pending'", "claim_corrupt"),
    ).toBe(1);
  });
});

describe("syllabus confirm", () => {
  let a: Client;
  let owned: Awaited<ReturnType<typeof buildTerm>>;
  // Enough assignments that both the inserts and the claim updates need several statements to
  // stay under D1's 100-parameter ceiling.
  const bulkIds = Array.from({ length: 40 }, (_, i) => `claim_http_bulk_${i}`);
  const claimIds = ["claim_http_cat", "claim_http_meet", "claim_http_quiz", ...bulkIds];

  beforeAll(async () => {
    a = await signIn("confirm@example.com");
    owned = await buildTerm(a);

    // Claims are seeded directly: producing them over HTTP needs a model, and what is under test
    // is what confirm does with them, not how they were read.
    const env = await server.getWorker<{ DB: D1Database }>().getEnv();
    const claim = env.DB.prepare(
      "INSERT INTO extraction_claims (id, source_document_id, claim_type, payload_json, review_status) VALUES (?, ?, ?, ?, 'pending')",
    );
    await env.DB.batch([
      claim.bind(
        claimIds[0],
        owned.documentId,
        "grading_category",
        JSON.stringify({ name: "Quizzes", weightPercent: 20, dropLowest: null }),
      ),
      claim.bind(
        claimIds[1],
        owned.documentId,
        "meeting_pattern",
        JSON.stringify({
          daysOfWeek: [1, 3],
          startTime: "10:00",
          endTime: "11:15",
          location: null,
        }),
      ),
      claim.bind(
        claimIds[2],
        owned.documentId,
        "assignment",
        JSON.stringify({
          title: "Quiz 1",
          type: "quiz",
          dueDate: { iso: "2026-09-18", time: null },
          pointsPossible: 10,
          category: "Quizzes",
          isMajorProject: false,
          confidenceStatus: "high_inference",
        }),
      ),
      ...bulkIds.map((id, i) =>
        claim.bind(
          id,
          owned.documentId,
          "assignment",
          JSON.stringify({
            title: `Reading ${i + 1}`,
            type: "reading",
            dueDate: { iso: "2026-10-01", time: null },
            pointsPossible: null,
            category: null,
            isMajorProject: false,
          }),
        ),
      ),
    ]);
  }, 60_000);

  async function created() {
    return {
      categories: await count("grading_categories", "course_id = ?", owned.courseId),
      meetingPatterns: await count("meeting_patterns", "course_id = ?", owned.courseId),
      workItems: await count(
        "work_items",
        "course_id = ? AND work_type IN ('quiz', 'reading')",
        owned.courseId,
      ),
    };
  }

  it("promotes accepted claims once, and a second submit creates nothing", async () => {
    const path = `/api/documents/${owned.documentId}/extraction/confirm`;

    const first = await a.send("POST", path, { acceptedClaimIds: claimIds });
    expect(first.status).toBe(200);
    expect(((await first.json()) as Json)["created"]).toEqual({
      categories: 1,
      meetingPatterns: 1,
      workItems: 41,
    });
    expect(await created()).toEqual({ categories: 1, meetingPatterns: 1, workItems: 41 });
    expect(
      await count(
        "extraction_claims",
        "source_document_id = ? AND review_status = 'accepted'",
        owned.documentId,
      ),
    ).toBe(43);
    // Each claim points at the record it became, not at a sibling's.
    expect(
      await count(
        "extraction_claims",
        "id = ? AND resolved_entity_type = 'work_item' AND resolved_entity_id = (SELECT id FROM work_items WHERE title = 'Quiz 1')",
        "claim_http_quiz",
      ),
    ).toBe(1);
    expect(
      await count(
        "extraction_claims e JOIN work_items w ON w.id = e.resolved_entity_id",
        "e.id LIKE 'claim_http_bulk_%' AND w.title = 'Reading ' || (CAST(substr(e.id, 17) AS INTEGER) + 1)",
      ),
    ).toBe(40);

    // A double click, or a retry after the first response was lost on the way back.
    const second = await a.send("POST", path, { acceptedClaimIds: claimIds });
    expect(second.status).toBe(200);
    expect(((await second.json()) as Json)["created"]).toEqual({
      categories: 0,
      meetingPatterns: 0,
      workItems: 0,
    });
    expect(await created()).toEqual({ categories: 1, meetingPatterns: 1, workItems: 41 });
  });

  it("promotes claims once when two submits arrive at the same moment", async () => {
    // A second document with claims of its own, so this does not depend on the test above.
    const env = await server.getWorker<{ DB: D1Database }>().getEnv();
    const doc = await buildTerm(a);
    const ids = Array.from({ length: 6 }, (_, i) => `claim_http_race_${i}`);
    const claim = env.DB.prepare(
      "INSERT INTO extraction_claims (id, source_document_id, claim_type, payload_json, review_status) VALUES (?, ?, 'assignment', ?, 'pending')",
    );
    await env.DB.batch(
      ids.map((id, i) =>
        claim.bind(
          id,
          doc.documentId,
          JSON.stringify({
            title: `Race ${i + 1}`,
            type: "reading",
            dueDate: { iso: "2026-10-02", time: null },
            pointsPossible: null,
            category: null,
            isMajorProject: false,
          }),
        ),
      ),
    );

    // Both requests read the claims as pending before either one writes.
    const path = `/api/documents/${doc.documentId}/extraction/confirm`;
    const responses = await Promise.all([
      a.send("POST", path, { acceptedClaimIds: ids }),
      a.send("POST", path, { acceptedClaimIds: ids }),
    ]);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as Json[];

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const createdItems = bodies.map((b) => (b["created"] as { workItems: number }).workItems);
    expect(createdItems.sort()).toEqual([0, 6]);
    expect(await count("work_items", "course_id = ? AND title LIKE 'Race %'", doc.courseId)).toBe(
      6,
    );
  });

  it("still refuses a submission that names no claim of this document", async () => {
    const res = await a.send("POST", `/api/documents/${owned.documentId}/extraction/confirm`, {
      acceptedClaimIds: ["claim_that_does_not_exist"],
    });
    expect(res.status).toBe(400);
  });
});

describe("syllabus page text", () => {
  it("refuses text past the caps with a 413 before anything reaches a model", async () => {
    const a = await signIn("pages@example.com");
    const owned = await buildTerm(a);
    const path = `/api/documents/${owned.documentId}/extract`;

    const onePageTooLong = await a.send("POST", path, {
      pages: [{ page: 1, text: "x".repeat(200_001) }],
    });
    expect(onePageTooLong.status).toBe(413);
    expect(String(((await onePageTooLong.json()) as Json)["error"])).toMatch(/Page 1 holds/);

    const tooMuchInAll = await a.send("POST", path, {
      pages: Array.from({ length: 4 }, (_, i) => ({ page: i + 1, text: "x".repeat(199_000) })),
    });
    expect(tooMuchInAll.status).toBe(413);
    expect(String(((await tooMuchInAll.json()) as Json)["error"])).toMatch(/This document holds/);

    // Refused before the document was marked as being read, so it is not left stuck there.
    expect(
      await count("source_documents", "id = ? AND processing_status = 'pending'", owned.documentId),
    ).toBe(1);
  }, 30_000);
});

describe("sign-in limit per address", () => {
  it("refuses past the limit without counting the refusals", async () => {
    // Dev mode multiplies the limit by ten (rate-limit.ts), and this harness runs in dev mode.
    const limit = 5 * 10;
    const statuses: number[] = [];
    for (let i = 0; i < limit + 5; i++) {
      statuses.push((await post("/api/auth/login", { email: "lockout@example.com" })).status);
    }
    expect(statuses.slice(0, limit).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(limit)).toEqual([429, 429, 429, 429, 429]);
    // The five refusals left the counter where the last allowed request put it.
    expect(
      await count("rate_limits", "bucket_key LIKE 'loginEmail:%' AND count = ?", `${limit}`),
    ).toBe(1);
    expect(
      await count("rate_limits", "bucket_key LIKE 'loginEmail:%' AND count > ?", `${limit}`),
    ).toBe(0);
  }, 60_000);
});

describe("sign-in before migration 0011", () => {
  it("still signs people in when the rate_limits table does not exist yet", async () => {
    // A Worker deployed ahead of its migration. The limiter must step aside, not take sign-in
    // down with it.
    const env = await server.getWorker<{ DB: D1Database }>().getEnv();
    const table = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rate_limits'",
    ).first<{ sql: string }>();
    await env.DB.prepare("DROP TABLE rate_limits").run();
    try {
      const res = await post("/api/auth/login", { email: "before-migration@example.com" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as Json)["devLoginUrl"]).toBeTruthy();
    } finally {
      await env.DB.prepare(table!.sql).run();
    }
  });
});

describe("saving a grading scheme", () => {
  async function categories(courseId: string) {
    const env = await server.getWorker<{ DB: D1Database }>().getEnv();
    const { results } = await env.DB.prepare(
      "SELECT id, name, weight_percent AS weight FROM grading_categories WHERE course_id = ? ORDER BY name",
    )
      .bind(courseId)
      .all<{ id: string; name: string; weight: number | null }>();
    return results;
  }

  async function categoryOf(workItemId: string) {
    const env = await server.getWorker<{ DB: D1Database }>().getEnv();
    const row = await env.DB.prepare(
      "SELECT grading_category_id AS id FROM work_items WHERE id = ?",
    )
      .bind(workItemId)
      .first<{ id: string | null }>();
    return row!.id;
  }

  it("keeps each category's id, so work items stay linked through an edit", async () => {
    const client = await signIn("grading-scheme@example.com");
    const { courseId, workItemId } = await buildTerm(client);
    const put = (body: unknown) => client.send("PUT", `/api/courses/${courseId}/grading`, body);

    expect(
      (
        await put({
          categories: [
            { name: "Labs", weightPercent: 30 },
            { name: "Quizzes", weightPercent: 20 },
          ],
        })
      ).status,
    ).toBe(200);
    const before = await categories(courseId);
    const labs = before.find((cat) => cat.name === "Labs")!;
    const quizzes = before.find((cat) => cat.name === "Quizzes")!;

    const created = await client.send("POST", "/api/work-items", {
      courseId,
      title: "Quiz 1",
      workType: "quiz",
      gradingCategoryId: quizzes.id,
    });
    const second = ((await created.json()) as { workItem: { id: string } }).workItem.id;
    expect(
      (await client.send("PATCH", `/api/work-items/${workItemId}`, { gradingCategoryId: labs.id }))
        .status,
    ).toBe(200);

    // One weight changed, Quizzes dropped, Exams added.
    expect(
      (
        await put({
          categories: [
            { name: "labs ", weightPercent: 40 },
            { name: "Exams", weightPercent: 50 },
          ],
        })
      ).status,
    ).toBe(200);

    const after = await categories(courseId);
    expect(after.map((cat) => cat.name)).toEqual(["Exams", "labs"]);
    expect(after.find((cat) => cat.name === "labs")).toMatchObject({ id: labs.id, weight: 40 });
    expect(await categoryOf(workItemId)).toBe(labs.id);
    // The dropped category takes its link with it rather than leaving the item dangling.
    expect(await categoryOf(second)).toBeNull();
  });

  it("keeps a renamed category's id when the editor sends it back", async () => {
    const client = await signIn("grading-rename@example.com");
    const { courseId, workItemId } = await buildTerm(client);
    const put = (body: unknown) => client.send("PUT", `/api/courses/${courseId}/grading`, body);

    await put({ categories: [{ name: "Quizzes", weightPercent: 20 }] });
    const [quizzes] = await categories(courseId);
    await client.send("PATCH", `/api/work-items/${workItemId}`, { gradingCategoryId: quizzes!.id });

    const res = await put({
      categories: [{ id: quizzes!.id, name: "Weekly Quizzes", weightPercent: 25 }],
    });
    expect(res.status).toBe(200);
    expect(await categories(courseId)).toEqual([
      { id: quizzes!.id, name: "Weekly Quizzes", weight: 25 },
    ]);
    expect(await categoryOf(workItemId)).toBe(quizzes!.id);
  });

  it("ignores an id that is not one of this course's categories", async () => {
    const client = await signIn("grading-foreign-id@example.com");
    const { courseId } = await buildTerm(client);
    const res = await client.send("PUT", `/api/courses/${courseId}/grading`, {
      categories: [{ id: "gradingCategory_someone_else", name: "Labs", weightPercent: 30 }],
    });
    expect(res.status).toBe(200);
    const [labs] = await categories(courseId);
    expect(labs).toMatchObject({ name: "Labs", weight: 30 });
    expect(labs!.id).not.toBe("gradingCategory_someone_else");
  });

  it("saves a full scheme of 24 categories in one go", async () => {
    const client = await signIn("grading-scheme-full@example.com");
    const { courseId } = await buildTerm(client);
    const res = await client.send("PUT", `/api/courses/${courseId}/grading`, {
      categories: Array.from({ length: 24 }, (_, i) => ({
        name: `Part ${i + 1}`,
        weightPercent: 4,
      })),
    });
    expect(res.status).toBe(200);
    expect(await categories(courseId)).toHaveLength(24);
  });
});
