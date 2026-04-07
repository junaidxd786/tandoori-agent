import { supabaseAdmin } from "./supabase-admin";

export interface RestaurantSettings {
  is_accepting_orders: boolean;
  opening_time: string;
  closing_time: string;
  min_delivery_amount: number;
  delivery_enabled: boolean;
  delivery_fee: number;
}

// No in-memory cache — always fetch live from Supabase.
// (Same fix as menu.ts: Next.js module isolation makes cross-route cache
//  invalidation unreliable, so we pay the tiny Supabase round-trip instead
//  of risking a stale open/closed state.)
export async function getRestaurantSettings(): Promise<RestaurantSettings> {
  const { data, error } = await supabaseAdmin
    .from("restaurant_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    console.error("getRestaurantSettings failed — defaulting to CLOSED (safe fallback):", error);
    // SAFE DEFAULT: fail closed so we don't accept orders we can't process
    return {
      is_accepting_orders: false,
      opening_time: "10:00 AM",
      closing_time: "11:00 PM",
      min_delivery_amount: 0,
      delivery_enabled: false,
      delivery_fee: 0,
    };
  }

  return data as RestaurantSettings;
}

export async function updateRestaurantSettings(settings: Partial<RestaurantSettings>) {
  const { error } = await supabaseAdmin
    .from("restaurant_settings")
    .update(settings)
    .eq("id", 1);

  if (error) {
    console.error("Failed to update settings:", error);
    throw new Error("Failed to update settings");
  }
  // No cache to invalidate — next read always goes to DB
}

/**
 * Check if the restaurant is currently within operating hours.
 * Parses "10:00 AM" / "11:00 PM" style strings.
 * Returns true if within hours, false if outside.
 */
export function isWithinOperatingHours(openingTime: string, closingTime: string): boolean {
  try {
    const TZ = process.env.RESTAURANT_TIMEZONE || "Asia/Karachi";
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
    const parseTime = (timeStr: string): Date => {
      const [time, period] = timeStr.trim().split(" ");
      const [hours, minutes] = time.split(":").map(Number);
      const d = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
      let h = hours;
      if (period?.toUpperCase() === "PM" && h !== 12) h += 12;
      if (period?.toUpperCase() === "AM" && h === 12) h = 0;
      d.setHours(h, minutes ?? 0, 0, 0);
      return d;
    };

    const open = parseTime(openingTime);
    const close = parseTime(closingTime);

    // Handle overnight (e.g. 10 PM – 2 AM)
    if (close < open) {
      return now >= open || now <= close;
    }
    return now >= open && now <= close;
  } catch {
    return false; // fail closed if parsing breaks
  }
}
