// Gulf Standard Time (UTC+4). Constant offset — no DST.
const GST_OFFSET_MS = 4 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function toGst(input: Date | string | number): Date {
  const d = input instanceof Date ? input : new Date(input);
  return new Date(d.getTime() + GST_OFFSET_MS);
}

// "18 Apr 2026, 09:39:50 GST"
export function formatGst(input: Date | string | number): string {
  const gst = toGst(input);
  const day = gst.getUTCDate().toString().padStart(2, "0");
  const month = MONTHS[gst.getUTCMonth()];
  const year = gst.getUTCFullYear();
  const hh = gst.getUTCHours().toString().padStart(2, "0");
  const mm = gst.getUTCMinutes().toString().padStart(2, "0");
  const ss = gst.getUTCSeconds().toString().padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}:${ss} GST`;
}

// Compact variant: "18 Apr, 09:39 GST" (useful for dense rows)
export function formatGstShort(input: Date | string | number): string {
  const gst = toGst(input);
  const day = gst.getUTCDate().toString().padStart(2, "0");
  const month = MONTHS[gst.getUTCMonth()];
  const hh = gst.getUTCHours().toString().padStart(2, "0");
  const mm = gst.getUTCMinutes().toString().padStart(2, "0");
  return `${day} ${month}, ${hh}:${mm} GST`;
}

// Time-only (HH:MM:SS GST) — for row timestamps where the date is already context
export function formatGstTime(input: Date | string | number): string {
  const gst = toGst(input);
  const hh = gst.getUTCHours().toString().padStart(2, "0");
  const mm = gst.getUTCMinutes().toString().padStart(2, "0");
  const ss = gst.getUTCSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss} GST`;
}
