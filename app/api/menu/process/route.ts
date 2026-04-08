import { NextRequest, NextResponse } from "next/server";
import { processMenuImage } from "@/lib/ai";
import { createMenuUpload, updateMenuUploadStatus, updateMenuFromExtraction } from "@/lib/menu";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = await req.json();

    if (!imageUrl) {
      return NextResponse.json({ error: "No image URL provided" }, { status: 400 });
    }

    // 1. Log upload
    const upload = await createMenuUpload(imageUrl);

    // 2. Process with AI Vision
    await updateMenuUploadStatus(upload.id, "processing");
    const result = await processMenuImage(imageUrl);

    // 3. Extract items (normalized array returned by processMenuImage)
    const items = result;
    
    if (items.length > 0) {
       // Optional: We could just return them to the UI for confirmation 
       // but the prompt says "Auto-extracts ... and populates an editable table".
       // Let's return them so the user can verify before final save.
       await updateMenuUploadStatus(upload.id, "completed");
       return NextResponse.json({ items });
    } else {
       await updateMenuUploadStatus(upload.id, "error", "No items found in image");
       return NextResponse.json({ error: "Could not extract menu items. Please try a clearer photo." }, { status: 422 });
    }

  } catch (error: any) {
    console.error("Menu processing error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
