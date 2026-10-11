import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { getDb } from "../db/repo.js";
import { limitOrRefuse } from "../rate-limit.js";
import { cleanCounts, recordUsage, usageBody } from "../usage.js";
import type { AppBindings } from "../env.js";

export const usageRoute = new Hono<AppBindings>();

/**
 * Screen and button counts from the app (see `usage.ts` for what is kept and why).
 *
 * Always 204 once the body has the right shape: an opted-out account, a refused write and a
 * database that is down all look the same to the client, which has nothing useful to do about
 * any of them. Only a malformed body is refused (400) and only an over-eager client is limited
 * (429), since both are the client's own bug to fix.
 */
usageRoute.post("/usage", async (c) => {
  const parsed = usageBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Expected { events: { name: count } }." }, 400);

  const userId = c.get("userId");
  try {
    const refused = await limitOrRefuse(c, "usage", userId);
    if (refused) return refused;

    const counts = cleanCounts(parsed.data.events);
    if (counts.size === 0) return c.body(null, 204);

    // Read here rather than trusted from the client: the switch can change on another device,
    // and an opted-out account must record nothing whatever an old tab still sends.
    const [user] = await getDb(c.env.DB)
      .select({ shareUsage: users.shareUsage })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.shareUsage) return c.body(null, 204);

    await recordUsage(c.env.DB, {
      userId,
      authSecret: c.env.AUTH_SECRET,
      counts,
      nowMs: Date.now(),
    });
  } catch (error) {
    // Fail open. Losing a few counts is fine; an error on screen over a counter is not.
    console.warn("[usage] not recorded:", error instanceof Error ? error.message : String(error));
  }
  return c.body(null, 204);
});
