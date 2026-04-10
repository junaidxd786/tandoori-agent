import { NextRequest, NextResponse } from "next/server";
import { getDashboardSession, resolveBranchIdForSession } from "./auth";

export async function requireApiSession() {
  const session = await getDashboardSession();
  if (!session) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      session: null,
    };
  }

  return { response: null, session };
}

export async function resolveRequestBranch(
  req: NextRequest,
  options?: { allowAllForAdmin?: boolean; requireBranch?: boolean },
) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return { response: auth.response, session: null, branchId: null as string | null };
  }

  const requestedBranchId = new URL(req.url).searchParams.get("branch_id");
  const branchId = resolveBranchIdForSession(auth.session, requestedBranchId, options);

  if (branchId === "__forbidden__") {
    return {
      response: NextResponse.json({ error: "Forbidden for the selected branch" }, { status: 403 }),
      session: auth.session,
      branchId: null as string | null,
    };
  }

  if (options?.requireBranch && !branchId) {
    return {
      response: NextResponse.json({ error: "A branch must be selected" }, { status: 400 }),
      session: auth.session,
      branchId: null as string | null,
    };
  }

  return {
    response: null,
    session: auth.session,
    branchId,
  };
}
