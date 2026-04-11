import { NextRequest, NextResponse } from "next/server";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ACTIVE_STATUSES = ["received", "preparing", "out_for_delivery"] as const;
const ALL_STATUSES = ["received", "preparing", "out_for_delivery", "delivered", "cancelled"] as const;

function getUtcRangeStart(daysAgo = 0): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  if (daysAgo > 0) {
    utc.setUTCDate(utc.getUTCDate() - daysAgo);
  }
  return utc.toISOString();
}

async function countRows(table: "orders" | "conversations", options: {
  branchId: string | null;
  statuses?: readonly string[];
  status?: string;
  gteCreatedAt?: string;
}) {
  let query = supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  if (options.branchId) {
    query = query.eq("branch_id", options.branchId);
  }
  if (options.statuses && options.statuses.length > 0) {
    query = query.in("status", [...options.statuses]);
  }
  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (options.gteCreatedAt) {
    query = query.gte("created_at", options.gteCreatedAt);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response) {
    return auth.response;
  }

  try {
    const todayStartIso = getUtcRangeStart(0);
    const thirtyDaysStartIso = getUtcRangeStart(30);

    const [
      active,
      today,
      chats,
      received,
      preparing,
      outForDelivery,
      delivered,
      cancelled,
      deliveredRows,
      recentOrdersRes,
    ] = await Promise.all([
      countRows("orders", { branchId: auth.branchId, statuses: ACTIVE_STATUSES }),
      countRows("orders", { branchId: auth.branchId, gteCreatedAt: todayStartIso }),
      countRows("conversations", { branchId: auth.branchId }),
      countRows("orders", { branchId: auth.branchId, status: "received" }),
      countRows("orders", { branchId: auth.branchId, status: "preparing" }),
      countRows("orders", { branchId: auth.branchId, status: "out_for_delivery" }),
      countRows("orders", { branchId: auth.branchId, status: "delivered" }),
      countRows("orders", { branchId: auth.branchId, status: "cancelled" }),
      (() => {
        let query = supabaseAdmin
          .from("orders")
          .select("subtotal")
          .eq("status", "delivered")
          .gte("created_at", thirtyDaysStartIso)
          .order("created_at", { ascending: false })
          .limit(500);
        if (auth.branchId) {
          query = query.eq("branch_id", auth.branchId);
        }
        return query;
      })(),
      (() => {
        let query = supabaseAdmin
          .from("orders")
          .select(`
            id,
            order_number,
            status,
            type,
            subtotal,
            created_at,
            branches (name),
            conversations (name)
          `)
          .order("created_at", { ascending: false })
          .limit(8);
        if (auth.branchId) {
          query = query.eq("branch_id", auth.branchId);
        }
        return query;
      })(),
    ]);

    if (deliveredRows.error) throw deliveredRows.error;
    if (recentOrdersRes.error) throw recentOrdersRes.error;

    const revenue = (deliveredRows.data ?? []).reduce((sum, row) => sum + Number(row.subtotal ?? 0), 0);
    const breakdown: Record<string, number> = {
      received,
      preparing,
      out_for_delivery: outForDelivery,
      delivered,
      cancelled,
    };

    return NextResponse.json({
      active,
      today,
      revenue,
      chats,
      breakdown,
      recentOrders: recentOrdersRes.data ?? [],
      statusKeys: ALL_STATUSES,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dashboard summary.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

