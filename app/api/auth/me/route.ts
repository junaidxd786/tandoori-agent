import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";

export async function GET() {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(session);
}
