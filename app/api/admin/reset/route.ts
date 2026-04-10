import { NextRequest, NextResponse } from "next/server";
import { wipeOperationalData } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type ResetBody = {
  branch_id?: string | null;
};

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = (await req.json()) as ResetBody;
    await wipeOperationalData({ branchId: body.branch_id ?? null });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to wipe data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
