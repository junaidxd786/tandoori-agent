import { NextRequest, NextResponse } from "next/server";
import { deleteBranch, updateBranch } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type BranchBody = {
  name?: string;
  slug?: string | null;
  address?: string;
  is_active?: boolean;
};

export async function PATCH(req: NextRequest, context: RouteContext<"/api/admin/branches/[id]">) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const body = (await req.json()) as BranchBody;
    const branch = await updateBranch(id, {
      name: body.name ?? "",
      slug: body.slug ?? null,
      address: body.address ?? "",
      isActive: body.is_active ?? true,
    });

    return NextResponse.json(branch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update branch.";
    const status = /required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_: NextRequest, context: RouteContext<"/api/admin/branches/[id]">) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    await deleteBranch(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete branch.";
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
