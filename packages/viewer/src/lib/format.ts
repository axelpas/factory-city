/** The only place where dates and numbers become text: browser locale, falling back to fr-CH. */
export const FALLBACK_LOCALE = "fr-CH";

export interface Formatter {
  readonly locale: string;
  integer(value: number): string;
  number(value: number, maxFractionDigits?: number): string;
  percent(ratio: number): string;
  date(value: string | Date): string;
  dateTime(value: string | Date): string;
}

export interface FormatOptions {
  /** Time zone for dates; defaults to the browser's. */
  timeZone?: string;
}

export function resolveLocale(preferred: readonly string[] | undefined): string {
  for (const candidate of preferred ?? []) {
    try {
      if (Intl.NumberFormat.supportedLocalesOf([candidate]).length > 0) return candidate;
    } catch {
      // not a valid locale tag: try the next one
    }
  }
  return FALLBACK_LOCALE;
}

export function createFormat(preferred?: readonly string[], options: FormatOptions = {}): Formatter {
  const locale = resolveLocale(preferred);
  const tz = options.timeZone ? { timeZone: options.timeZone } : {};
  const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));
  return {
    locale,
    integer: (v) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v),
    number: (v, max = 2) => new Intl.NumberFormat(locale, { maximumFractionDigits: max }).format(v),
    percent: (v) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(v),
    date: (v) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...tz }).format(toDate(v)),
    dateTime: (v) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", ...tz }).format(toDate(v)),
  };
}

function browserLanguages(): readonly string[] | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.languages;
}

/** Default formatter, in the browser's locale. */
export const format: Formatter = createFormat(browserLanguages());
