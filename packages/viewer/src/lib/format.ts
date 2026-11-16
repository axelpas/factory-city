/** The only place where dates and numbers become text: browser locale, falling back to fr-CH. */
export const FALLBACK_LOCALE = "fr-CH";

export interface Formatter {
  readonly locale: string;
  integer(value: number): string;
  number(value: number, maxFractionDigits?: number): string;
  percent(ratio: number): string;
  /** The code-health score (0 to 100) as a percentage with one decimal: "41,8 %". */
  score(value: number): string;
  /** A number with its unit, in agreement: "1 module", "6 modules"; a share reads as a percentage. */
  quantity(value: number, unit: string): string;
  date(value: string | Date): string;
  dateTime(value: string | Date): string;
}

/** Units that are not written after the number. */
const UNITLESS = new Set(["", "flag", "ratio", "category"]);

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
  const number = (v: number, max = 2) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: max }).format(v);
  const percent = (v: number) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(v);
  const score = (v: number) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(v / 100);
  return {
    locale,
    integer: (v) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v),
    number,
    percent,
    score,
    quantity: (v, unit) => {
      if (unit === "share") return percent(v);
      if (UNITLESS.has(unit)) return number(v);
      // registry units are plural words: one of them loses its final "s"
      const word = Math.abs(v) === 1 && /^[a-z]+s$/.test(unit) ? unit.slice(0, -1) : unit;
      return `${number(v)} ${word}`;
    },
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
