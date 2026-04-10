import { NextResponse } from "next/server";
import { clearDashboardSessionCookies } from "@/lib/auth";

export async function POST() {
  await clearDashboardSessionCookies();
  return NextResponse.json({ success: true });
}
