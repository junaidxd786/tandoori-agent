import {
  buildRestaurantDateTimeIso,
  getRestaurantNowParts,
  parseRestaurantClock,
} from "./restaurant-time.ts";
import { normalizeText } from "./order-text-utils.ts";

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  ek: 1,
  aik: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  panj: 5,
  paanch: 5,
  cheh: 6,
  chay: 6,
  saat: 7,
  aath: 8,
  ath: 8,
  das: 10,
};

const ADDRESS_HINTS = [
  "street",
  "st",
  "road",
  "rd",
  "house",
  "flat",
  "apartment",
  "block",
  "sector",
  "phase",
  "lane",
  "gali",
  "mohalla",
  "near",
  "opposite",
  "plot",
];

function isWithinOperatingHoursForTime(
  requestedHours: number,
  requestedMinutes: number,
  openingTime: string,
  closingTime: string,
): boolean {
  const parsedOpening = parseRestaurantClock(openingTime);
  const parsedClosing = parseRestaurantClock(closingTime);
  if (!parsedOpening || !parsedClosing) return false;

  const totalRequestedMinutes = requestedHours * 60 + requestedMinutes;

  if (parsedClosing.totalMinutes < parsedOpening.totalMinutes) {
    return totalRequestedMinutes >= parsedOpening.totalMinutes || totalRequestedMinutes <= parsedClosing.totalMinutes;
  }

  return totalRequestedMinutes >= parsedOpening.totalMinutes && totalRequestedMinutes <= parsedClosing.totalMinutes;
}

export function parseNumericToken(token: string): number | null {
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  if (token in NUMBER_WORDS) return NUMBER_WORDS[token];
  return null;
}

export function extractAnyQuantity(text: string): number | null {
  const tokens = normalizeText(text).split(" ");
  for (const token of tokens) {
    const value = parseNumericToken(token);
    if (value != null) return value;
  }
  return null;
}

export function extractQuantityNearPhrase(text: string, phrase: string): number | null {
  const tokens = text.split(" ");
  const phraseTokens = phrase.split(" ");

  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    const window = tokens.slice(index, index + phraseTokens.length).join(" ");
    if (window !== phrase) continue;

    const around = [
      ...tokens.slice(Math.max(0, index - 3), index),
      ...tokens.slice(index + phraseTokens.length, index + phraseTokens.length + 2),
    ];
    for (const token of around.reverse()) {
      const parsed = parseNumericToken(token);
      if (parsed != null) return parsed;
    }
    return 1;
  }

  return null;
}

export function parseAddress(raw: string): string | null {
  const compact = raw.trim().replace(/\s+/g, " ");
  if (!compact || compact.length < 8) return null;
  const normalized = normalizeText(compact);
  const hasHint = ADDRESS_HINTS.some((hint) => normalized.includes(hint));
  const hasNumber = /\d/.test(compact);
  const tokenCount = normalized.split(" ").filter(Boolean).length;
  const hasLocationSignal = /\b(city|town|colony|society|area|sector|block|phase|near|opposite)\b/.test(
    normalized,
  );
  const hasSeparator = /[,/.-]/.test(compact);

  if (!hasNumber) return null;
  if (!hasHint && !(hasLocationSignal && tokenCount >= 3) && !(hasSeparator && tokenCount >= 3)) return null;
  return compact;
}

export function parseGuestCount(text: string, clampQty: (qty: number) => number): number | null {
  const match = text.match(/(\d{1,2})\s*(guest|guests|person|people|bande|seats?|table)/i);
  if (match) return clampQty(Number.parseInt(match[1], 10));

  const tokenized = normalizeText(text).split(" ");
  for (const token of tokenized) {
    const parsed = parseNumericToken(token);
    if (parsed && parsed > 0) return clampQty(parsed);
  }
  return null;
}

export function parseReservationTime(
  text: string,
  settings?: { opening_time: string; closing_time: string },
): string | null {
  const normalized = text.trim();
  const amPm = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const twentyFour = normalized.match(/\b(\d{1,2}):(\d{2})\b/);
  const relative = normalized.match(/in\s+(\d{1,3})\s*(minute|minutes|min|hour|hours|hr)/i);

  let hours: number | null = null;
  let minutes = 0;

  if (relative) {
    const amount = Number.parseInt(relative[1], 10);
    const unit = relative[2].toLowerCase();
    const now = getRestaurantNowParts();
    const nowTotalMinutes = now.hour * 60 + now.minute;

    let targetMinutes: number;
    if (unit.startsWith("hour") || unit.startsWith("hr")) {
      targetMinutes = nowTotalMinutes + amount * 60;
    } else {
      targetMinutes = nowTotalMinutes + amount;
    }

    hours = Math.floor(targetMinutes / 60) % 24;
    minutes = targetMinutes % 60;

    const year = now.year;
    let month = now.month;
    let day = now.day;
    if (targetMinutes >= 24 * 60) {
      const rollover = new Date(Date.UTC(now.year, now.month - 1, now.day, 12, 0, 0));
      rollover.setUTCDate(rollover.getUTCDate() + 1);
      month = rollover.getUTCMonth() + 1;
      day = rollover.getUTCDate();
    }

    const parsedTime = buildRestaurantDateTimeIso(year, month, day, hours, minutes);

    if (settings && !isWithinOperatingHoursForTime(hours, minutes, settings.opening_time, settings.closing_time)) {
      return null;
    }

    return parsedTime;
  }

  if (amPm) {
    hours = Number.parseInt(amPm[1], 10);
    minutes = amPm[2] ? Number.parseInt(amPm[2], 10) : 0;
    const period = amPm[3].toLowerCase();
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
  } else if (twentyFour) {
    hours = Number.parseInt(twentyFour[1], 10);
    minutes = Number.parseInt(twentyFour[2], 10);
  }

  if (hours == null || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  if (settings && !isWithinOperatingHoursForTime(hours, minutes, settings.opening_time, settings.closing_time)) {
    return null;
  }

  const now = getRestaurantNowParts();
  let year = now.year;
  let month = now.month;
  let day = now.day;
  const requestedTotal = hours * 60 + minutes;
  const nowTotal = now.hour * 60 + now.minute;

  if (requestedTotal < nowTotal) {
    const rollover = new Date(Date.UTC(now.year, now.month - 1, now.day, 12, 0, 0));
    rollover.setUTCDate(rollover.getUTCDate() + 1);
    year = rollover.getUTCFullYear();
    month = rollover.getUTCMonth() + 1;
    day = rollover.getUTCDate();
  }

  return buildRestaurantDateTimeIso(year, month, day, hours, minutes);
}

export function getGreetingReply(rawText: string, romanUrdu: boolean): string {
  const text = rawText.toLowerCase();
  const isSalam = /\b(assalam|aoa|salam)\b/.test(text);

  if (romanUrdu) {
    return isSalam
      ? "Walaikum Assalam! Aapko kya order karna hai? Item ka naam bhej dein."
      : "Hello! Aapko kya order karna hai? Item ka naam bhej dein.";
  } else {
    return isSalam
      ? "Walaikum Assalam! What would you like to order? Send any item name."
      : "Hello! What would you like to order? Send any item name.";
  }
}

export function isSimpleGreetingPattern(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return /\b(assalam|aoa|salam|hello|hi|hey|good\s+(morning|afternoon|evening)|namaste|namaskar)\b/i.test(normalized) &&
         normalized.split(/\s+/).length <= 5;
}

export function isSimpleAcknowledgmentPattern(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  const simpleWords = /\b(ok|okay|yes|no|thanks|thank\s+you|shukriya|theek|fine|good|alright|sure|haan|na|nahi|acha|thik)\b/i;
  return simpleWords.test(normalized) && normalized.split(/\s+/).length <= 3;
}
