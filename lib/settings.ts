import { supabaseAdmin } from "./supabase-admin";

export interface RestaurantSettings {
  is_accepting_orders: boolean;
  opening_time: string;
  closing_time: string;
  min_delivery_amount: number;
  delivery_enabled: boolean;
  delivery_fee: number;
}

export interface ParsedRestaurantClock {
  hours24: number;
  minutes: number;
  totalMinutes: number;
  normalized: string;
}

type TimeZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const RESTAURANT_TIMEZONE = process.env.RESTAURANT_TIMEZONE || "Asia/Karachi";

export function getRestaurantTimeZone(): string {
  return RESTAURANT_TIMEZONE;
}

export function parseRestaurantClock(value: string): ParsedRestaurantClock | null {
  const raw = value.trim();
  const twelveHourMatch = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  const twentyFourHourMatch = raw.match(/^(\d{1,2}):(\d{2})$/);

  let hours24: number | null = null;
  let minutes: number | null = null;

  if (twelveHourMatch) {
    const hours = Number.parseInt(twelveHourMatch[1], 10);
    minutes = Number.parseInt(twelveHourMatch[2], 10);
    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    const period = twelveHourMatch[3].toUpperCase();
    hours24 = hours % 12;
    if (period === "PM") hours24 += 12;
  } else if (twentyFourHourMatch) {
    hours24 = Number.parseInt(twentyFourHourMatch[1], 10);
    minutes = Number.parseInt(twentyFourHourMatch[2], 10);
    if (hours24 < 0 || hours24 > 23 || minutes < 0 || minutes > 59) return null;
  } else {
    return null;
  }

  const displayHours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const period = hours24 >= 12 ? "PM" : "AM";

  return {
    hours24,
    minutes,
    totalMinutes: hours24 * 60 + minutes,
    normalized: `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`,
  };
}

export function normalizeRestaurantClock(value: string): string | null {
  return parseRestaurantClock(value)?.normalized ?? null;
}

function getTimeZoneParts(date: Date, timeZone = getRestaurantTimeZone()): TimeZoneParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const extracted = formatter.formatToParts(date).reduce<Record<string, number>>((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = Number.parseInt(part.value, 10);
    }
    return accumulator;
  }, {});

  return {
    year: extracted.year,
    month: extracted.month,
    day: extracted.day,
    hour: extracted.hour,
    minute: extracted.minute,
    second: extracted.second,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone = getRestaurantTimeZone()): number {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

export function getRestaurantNowParts(): TimeZoneParts {
  return getTimeZoneParts(new Date(), getRestaurantTimeZone());
}

export function buildRestaurantDateTimeIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = getRestaurantTimeZone(),
): string {
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = getTimeZoneOffsetMs(new Date(timestamp), timeZone);
    const nextTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset;
    if (nextTimestamp === timestamp) break;
    timestamp = nextTimestamp;
  }

  return new Date(timestamp).toISOString();
}

export function validateRestaurantSettingsInput(settings: Partial<RestaurantSettings>) {
  const normalized: Partial<RestaurantSettings> = {};

  if (settings.is_accepting_orders !== undefined) {
    normalized.is_accepting_orders = Boolean(settings.is_accepting_orders);
  }

  if (settings.delivery_enabled !== undefined) {
    normalized.delivery_enabled = Boolean(settings.delivery_enabled);
  }

  if (settings.delivery_fee !== undefined) {
    const deliveryFee = Number(settings.delivery_fee);
    if (!Number.isFinite(deliveryFee) || deliveryFee < 0) {
      throw new Error("Delivery fee must be a non-negative number.");
    }
    normalized.delivery_fee = deliveryFee;
  }

  if (settings.min_delivery_amount !== undefined) {
    const minimum = Number(settings.min_delivery_amount);
    if (!Number.isFinite(minimum) || minimum < 0) {
      throw new Error("Minimum delivery amount must be a non-negative number.");
    }
    normalized.min_delivery_amount = minimum;
  }

  if (settings.opening_time !== undefined) {
    const openingTime = normalizeRestaurantClock(settings.opening_time);
    if (!openingTime) {
      throw new Error("Opening time must use a valid time such as 10:00 AM.");
    }
    normalized.opening_time = openingTime;
  }

  if (settings.closing_time !== undefined) {
    const closingTime = normalizeRestaurantClock(settings.closing_time);
    if (!closingTime) {
      throw new Error("Closing time must use a valid time such as 11:00 PM.");
    }
    normalized.closing_time = closingTime;
  }

  const candidateOpening = normalized.opening_time ?? settings.opening_time;
  const candidateClosing = normalized.closing_time ?? settings.closing_time;
  if (candidateOpening !== undefined && candidateClosing !== undefined) {
    const parsedOpening = parseRestaurantClock(candidateOpening);
    const parsedClosing = parseRestaurantClock(candidateClosing);
    if (!parsedOpening || !parsedClosing) {
      throw new Error("Opening and closing times must both be valid.");
    }
  }

  return normalized;
}

export async function getRestaurantSettings(): Promise<RestaurantSettings> {
  const { data, error } = await supabaseAdmin
    .from("restaurant_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    console.error("[getRestaurantSettings] Falling back to safe defaults:", error);
    return {
      is_accepting_orders: false,
      opening_time: "10:00 AM",
      closing_time: "11:00 PM",
      min_delivery_amount: 0,
      delivery_enabled: false,
      delivery_fee: 0,
    };
  }

  return {
    is_accepting_orders: data.is_accepting_orders,
    opening_time: data.opening_time,
    closing_time: data.closing_time,
    min_delivery_amount: Number(data.min_delivery_amount ?? 0),
    delivery_enabled: Boolean(data.delivery_enabled),
    delivery_fee: Number(data.delivery_fee ?? 0),
  };
}

export async function updateRestaurantSettings(settings: Partial<RestaurantSettings>) {
  const validated = validateRestaurantSettingsInput(settings);
  const { error } = await supabaseAdmin.from("restaurant_settings").update(validated).eq("id", 1);
  if (error) {
    console.error("[updateRestaurantSettings] Failed:", error);
    throw new Error("Failed to update settings");
  }
}

export function isWithinOperatingHours(openingTime: string, closingTime: string): boolean {
  const parsedOpening = parseRestaurantClock(openingTime);
  const parsedClosing = parseRestaurantClock(closingTime);
  if (!parsedOpening || !parsedClosing) return false;

  const now = getRestaurantNowParts();
  const nowMinutes = now.hour * 60 + now.minute;

  if (parsedClosing.totalMinutes < parsedOpening.totalMinutes) {
    return nowMinutes >= parsedOpening.totalMinutes || nowMinutes <= parsedClosing.totalMinutes;
  }

  return nowMinutes >= parsedOpening.totalMinutes && nowMinutes <= parsedClosing.totalMinutes;
}
