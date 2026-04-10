import { NextRequest, NextResponse } from "next/server";
import { resolveRequestBranch } from "@/lib/branch-request";

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    role: auth.session.role,
    defaultBranchId: auth.session.defaultBranchId,
    branches: auth.session.allowedBranches,
  });
}
