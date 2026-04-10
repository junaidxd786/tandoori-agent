import { NextResponse } from "next/server";
import { getDashboardSession } from "./auth";

export async function requireAdminApiSession() {
  const session = await getDashboardSession();
  if (!session) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      session: null,
    };
  }

  if (session.role !== "admin") {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      session: null,
    };
  }

  return {
    response: null,
    session,
  };
}
