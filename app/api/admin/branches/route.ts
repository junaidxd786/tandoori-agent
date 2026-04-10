import { NextRequest, NextResponse } from "next/server";
import { createBranch, listBranchesWithStats } from "@/lib/admin";
import { requireAdminApiSession } from "@/lib/admin-request";

type BranchBody = {
  name?: string;
  slug?: string | null;
  address?: string;
  is_active?: boolean;
};

export async function GET() {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const branches = await listBranchesWithStats();
    return NextResponse.json(branches);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load branches.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiSession();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = (await req.json()) as BranchBody;
    const branch = await createBranch({
      name: body.name ?? "",
      slug: body.slug ?? null,
      address: body.address ?? "",
      isActive: body.is_active ?? true,
    });

    return NextResponse.json(branch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create branch.";
    const status = /required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
