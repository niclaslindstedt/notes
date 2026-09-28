// The time of day the way this device writes it: "7:26:05 AM" where the
// locale keeps a 12-hour clock (en-US), "07:26:05" where it keeps a 24-hour
// one (sv-SE, en-GB). It follows the DEVICE's locale rather than the app's
// language, because the clock is a regional format, not a translation — an
// American and a Briton read the same English catalog and expect different
// clocks.
//
// Only for what is shown and forgotten (log lines, the crash report). A time
// that is stored or compared — a note's default title, the dropzone's name —
// stays in its fixed `YYYY-MM-DD HH:mm` form, so every device derives the same
// string from the same moment.

export type ClockOptions = {
  /** Include the seconds (log lines do). */
  seconds?: boolean;
  /** A BCP 47 tag; the device's own locale when omitted. Tests pin one. */
  locale?: string;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  locale: string | undefined,
  seconds: boolean,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${seconds}`;
  let f = formatters.get(key);
  if (!f) {
    // A 12-hour clock writes the hour bare ("7:26 AM"); a 24-hour one pads it
    // ("07:26"), as the log lines always have.
    const { hourCycle } = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions();
    const twelveHour = hourCycle === "h11" || hourCycle === "h12";
    f = new Intl.DateTimeFormat(locale, {
      hour: twelveHour ? "numeric" : "2-digit",
      minute: "2-digit",
      ...(seconds && { second: "2-digit" }),
    });
    formatters.set(key, f);
  }
  return f;
}

/** The time of day at `ts` on this device's clock. ICU puts a narrow
 *  no-break space before "AM"; it is written as a plain one, so a copied log
 *  line pastes as ordinary text. */
export function formatClockTime(
  ts: number,
  options: ClockOptions = {},
): string {
  return formatter(options.locale, options.seconds ?? false)
    .format(ts)
    .replace(/[\u202f\u00a0]/g, " ");
}
