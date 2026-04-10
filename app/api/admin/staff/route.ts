import { NextRequest, NextResponse } from "next/server";
import { createStaffAccount, listStaffMembers } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type StaffBody = {
  email?: string;
  password?: string;
  full_name?: string;
  role?: "admin" | "branch_staff";
  default_branch_id?: string | null;
  branch_ids?: string[];
};

export async function GET() {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const staff = await listStaffMembers();
    return NextResponse.json(staff);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load staff.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = (await req.json()) as StaffBody;
    const userId = await createStaffAccount({
      email: body.email ?? "",
      password: body.password ?? "",
      fullName: body.full_name ?? "",
      role: body.role ?? "branch_staff",
      defaultBranchId: body.default_branch_id ?? null,
      branchIds: body.branch_ids ?? [],
    });

    return NextResponse.json({ success: true, userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create staff account.";
    const status = /required|least|must/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
