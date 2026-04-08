import { NextRequest, NextResponse } from "next/server";
import { getRestaurantSettings, updateRestaurantSettings, validateRestaurantSettingsInput } from "@/lib/settings";

export async function GET() {
  try {
    const settings = await getRestaurantSettings();
    return NextResponse.json(settings);
  } catch {
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = validateRestaurantSettingsInput(body);
    await updateRestaurantSettings(validated);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update settings";
    const status = /valid|must/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
