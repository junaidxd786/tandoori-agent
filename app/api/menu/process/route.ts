import { NextRequest, NextResponse } from "next/server";
import { resolveRequestBranch } from "@/lib/branch-request";
import { processMenuImage } from "@/lib/ai";
import { createMenuUpload, updateMenuUploadStatus } from "@/lib/menu";

type MenuProcessBody = {
  imageUrl?: string;
};

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveRequestBranch(req, { requireBranch: true });
    if (auth.response || !auth.branchId) {
      return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as MenuProcessBody;
    if (!body.imageUrl) {
      return NextResponse.json({ error: "No image URL provided" }, { status: 400 });
    }

    const upload = await createMenuUpload(auth.branchId, body.imageUrl);
    await updateMenuUploadStatus(upload.id, "processing");

    const items = await processMenuImage(body.imageUrl);
    if (!Array.isArray(items) || items.length === 0) {
      await updateMenuUploadStatus(upload.id, "error", "No items found in image");
      return NextResponse.json({ error: "Could not extract menu items from the image." }, { status: 422 });
    }

    await updateMenuUploadStatus(upload.id, "completed");
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Menu processing failed";
    console.error("[menu/process] Failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
