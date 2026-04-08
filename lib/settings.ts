import { supabaseAdmin } from "./supabase-admin";

export interface RestaurantSettings {
  is_accepting_orders: boolean;
  opening_time: string;
  closing_time: string;
  min_delivery_amount: number;
  delivery_enabled: boolean;
  delivery_fee: number;
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
  const { error } = await supabaseAdmin.from("restaurant_settings").update(settings).eq("id", 1);
  if (error) {
    console.error("[updateRestaurantSettings] Failed:", error);
    throw new Error("Failed to update settings");
  }
}

export function isWithinOperatingHours(openingTime: string, closingTime: string): boolean {
  try {
    const timezone = process.env.RESTAURANT_TIMEZONE || "Asia/Karachi";
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));

    const parseClock = (value: string): Date => {
      const [time, period] = value.trim().split(" ");
      const [rawHours, rawMinutes] = time.split(":").map(Number);
      const date = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
      let hours = rawHours;
      if (period?.toUpperCase() === "PM" && hours !== 12) hours += 12;
      if (period?.toUpperCase() === "AM" && hours === 12) hours = 0;
      date.setHours(hours, rawMinutes ?? 0, 0, 0);
      return date;
    };

    const open = parseClock(openingTime);
    const close = parseClock(closingTime);

    if (close < open) {
      return now >= open || now <= close;
    }

    return now >= open && now <= close;
  } catch {
    return false;
  }
}
