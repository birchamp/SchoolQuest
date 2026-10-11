import { z } from "zod";

/** "HH:MM" on a 24-hour clock, as every meeting, commitment and availability time is stored. */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** A calendar date, "YYYY-MM-DD". */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
