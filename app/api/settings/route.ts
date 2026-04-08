import { NextRequest, NextResponse } from "next/server";
import { getRestaurantSettings, updateRestaurantSettings } from "@/lib/settings";

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
    await updateRestaurantSettings(body);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
