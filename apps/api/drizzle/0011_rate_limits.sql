-- Fixed-window counters for the rate limiter (apps/api/src/rate-limit.ts).
--
-- Sign-in sends real email through Resend and the AI routes spend an OpenRouter key, and
-- neither had any ceiling: anyone could flood an address with sign-in links or run up a bill
-- with a loop. D1 rather than KV or a Durable Object because it is already bound, it is on the
-- free tier, and an upsert on a composite key is an atomic increment.
--
-- bucket_key is the rule name plus a hash of the subject, never a raw email or IP.
CREATE TABLE `rate_limits` (
	`bucket_key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`bucket_key`, `window_start`)
);
