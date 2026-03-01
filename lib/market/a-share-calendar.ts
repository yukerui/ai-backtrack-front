import "server-only";

type HolidayRange = {
  start: string;
  end: string;
};

const SHANGHAI_TIMEZONE = "Asia/Shanghai";
const HOLIDAY_ENDPOINT =
  "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_ZGXSRL&columns=ALL&pageNumber=1&pageSize=500&filter=(MKT=%22A%E8%82%A1%22)";
const CALENDAR_MODE = (
  process.env.A_SHARE_CALENDAR_MODE || "local"
).toLowerCase();
const CALENDAR_CACHE_MS = Number.parseInt(
  process.env.A_SHARE_CALENDAR_CACHE_MS || `${6 * 60 * 60 * 1000}`,
  10
);
const CALENDAR_TIMEOUT_MS = Number.parseInt(
  process.env.A_SHARE_CALENDAR_TIMEOUT_MS || "4000",
  10
);

let cachedRanges: HolidayRange[] = [];
let cachedAt = 0;

function getDateFormatter() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function getWeekdayFormatter() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI_TIMEZONE,
    weekday: "short",
  });
}

function parseDateString(value: string) {
  return String(value || "").slice(0, 10);
}

function parseHolidayRanges(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [] as HolidayRange[];
  }

  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") {
    return [] as HolidayRange[];
  }

  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [] as HolidayRange[];
  }

  const ranges: HolidayRange[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const start = parseDateString((item as { SDATE?: unknown }).SDATE as string);
    const end = parseDateString((item as { EDATE?: unknown }).EDATE as string);
    if (!start || !end) {
      continue;
    }
    ranges.push({ start, end });
  }

  return ranges;
}

async function fetchHolidayRanges() {
  const timeoutMs =
    Number.isFinite(CALENDAR_TIMEOUT_MS) && CALENDAR_TIMEOUT_MS > 0
      ? CALENDAR_TIMEOUT_MS
      : 4000;
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(HOLIDAY_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`holiday_http_${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return parseHolidayRanges(payload);
}

async function getHolidayRanges() {
  const cacheMs =
    Number.isFinite(CALENDAR_CACHE_MS) && CALENDAR_CACHE_MS > 0
      ? CALENDAR_CACHE_MS
      : 6 * 60 * 60 * 1000;
  const now = Date.now();
  if (cachedRanges.length > 0 && now - cachedAt < cacheMs) {
    return cachedRanges;
  }

  const ranges = await fetchHolidayRanges();
  if (ranges.length > 0) {
    cachedRanges = ranges;
    cachedAt = now;
  }
  return cachedRanges;
}

export function getShanghaiDateString(date: Date) {
  return getDateFormatter().format(date);
}

function isWeekendShanghai(date: Date) {
  const weekday = getWeekdayFormatter().format(date);
  return weekday === "Sat" || weekday === "Sun";
}

function isInHolidayRange(day: string, ranges: HolidayRange[]) {
  return ranges.some((range) => day >= range.start && day <= range.end);
}

export async function isAShareTradingDay(date: Date) {
  if (isWeekendShanghai(date)) {
    return false;
  }

  if (CALENDAR_MODE === "weekend_only") {
    return true;
  }

  const day = getShanghaiDateString(date);
  try {
    const ranges = await getHolidayRanges();
    if (ranges.length === 0) {
      return true;
    }
    return !isInHolidayRange(day, ranges);
  } catch {
    // Fallback to weekend-only if remote calendar is unavailable.
    return true;
  }
}
