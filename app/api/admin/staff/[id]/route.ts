import { NextRequest, NextResponse } from "next/server";
import { deleteStaffAccount, updateStaffAccount } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type StaffBody = {
  full_name?: string;
  role?: "admin" | "branch_staff";
  default_branch_id?: string | null;
  branch_ids?: string[];
  password?: string | null;
};

export async function PATCH(req: NextRequest, context: RouteContext<"/api/admin/staff/[id]">) {
  const auth = await requireAdminApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = (await req.json()) as StaffBody;
    await updateStaffAccount(id, {
      fullName: body.full_name ?? "",
      role: body.role ?? "branch_staff",
      defaultBranchId: body.default_branch_id ?? null,
      branchIds: body.branch_ids ?? [],
      password: body.password ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update staff account.";
    const status = /required|least|must/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_: NextRequest, context: RouteContext<"/api/admin/staff/[id]">) {
  const auth = await requireAdminApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    if (id === auth.session.userId) {
      return NextResponse.json({ error: "You cannot delete your own admin account." }, { status: 400 });
    }

    await deleteStaffAccount(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete staff account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
