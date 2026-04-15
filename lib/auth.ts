import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase-admin";
import type { BranchSummary } from "./branches";

export type StaffRole = "admin" | "branch_staff";

export interface DashboardSession {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: StaffRole;
  defaultBranchId: string | null;
  allowedBranches: BranchSummary[];
}

const ACCESS_COOKIE = "dashboard-access-token";
const REFRESH_COOKIE = "dashboard-refresh-token";

function createAnonServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

type AuthSessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
};

type StaffProfileRow = {
  full_name: string | null;
  role: StaffRole;
  default_branch_id: string | null;
};

export async function signInWithPassword(email: string, password: string) {
  const client = createAnonServerClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session || !data.user) {
    throw error ?? new Error("Invalid login response.");
  }

  return data.session;
}

export async function setDashboardSessionCookies(payload: AuthSessionPayload) {
  const cookieStore = await cookies();
  const expires = payload.expires_at ? new Date(payload.expires_at * 1000) : undefined;

  cookieStore.set(ACCESS_COOKIE, payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
  cookieStore.set(REFRESH_COOKIE, payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}

export async function clearDashboardSessionCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
}

async function getVerifiedUser(accessToken: string | undefined) {
  if (!accessToken) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    return null;
  }

  return data.user;
}

async function loadStaffProfile(userId: string): Promise<StaffProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from("staff_profiles")
    .select("full_name, role, default_branch_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[auth] Failed to load staff profile:", error);
    return null;
  }

  return data ?? null;
}

async function loadAllowedBranches(userId: string, role: StaffRole): Promise<BranchSummary[]> {
  if (role === "admin") {
    const { data, error } = await supabaseAdmin
      .from("branches")
      .select("id, slug, name, city, address")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[auth] Failed to load admin branches:", error);
      return [];
    }

    return data ?? [];
  }

  const { data, error } = await supabaseAdmin
    .from("staff_branch_access")
    .select("branch_id, branches!inner(id, slug, name, city, address)")
    .eq("user_id", userId)
    .order("branch_id", { ascending: true });

  if (error) {
    console.error("[auth] Failed to load branch assignments:", error);
    return [];
  }

  return (data ?? [])
    .map((row) => {
      const branch = Array.isArray(row.branches) ? row.branches[0] : row.branches;
      return branch
        ? {
            id: branch.id,
          slug: branch.slug,
          name: branch.name,
          city: branch.city,
          address: branch.address,
        }
        : null;
    })
    .filter((branch): branch is BranchSummary => branch != null);
}

export const getDashboardSession = cache(async (): Promise<DashboardSession | null> => {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const user = await getVerifiedUser(accessToken);
  if (!user) return null;

  const profile = await loadStaffProfile(user.id);
  if (!profile) return null;

  const allowedBranches = await loadAllowedBranches(user.id, profile.role);
  const defaultBranchId =
    profile.default_branch_id && allowedBranches.some((branch) => branch.id === profile.default_branch_id)
      ? profile.default_branch_id
      : allowedBranches[0]?.id ?? null;

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile.full_name,
    role: profile.role,
    defaultBranchId,
    allowedBranches,
  };
});

export async function requireDashboardSession() {
  const session = await getDashboardSession();
  if (!session) {
    redirect("/login");
  }

  return session;
}

export function isBranchAllowed(session: DashboardSession, branchId: string | null) {
  if (branchId == null) return session.role === "admin";
  return session.allowedBranches.some((branch) => branch.id === branchId);
}

export function resolveBranchIdForSession(
  session: DashboardSession,
  requestedBranchId: string | null,
  options?: { allowAllForAdmin?: boolean; requireBranch?: boolean },
) {
  const allowAllForAdmin = options?.allowAllForAdmin ?? false;
  const requireBranch = options?.requireBranch ?? false;

  if (!requestedBranchId || requestedBranchId === "default") {
    if (session.role === "admin" && allowAllForAdmin && !requireBranch) {
      return null;
    }

    return session.defaultBranchId ?? session.allowedBranches[0]?.id ?? null;
  }

  if (requestedBranchId === "all") {
    return allowAllForAdmin && session.role === "admin" && !requireBranch ? null : "__forbidden__";
  }

  return isBranchAllowed(session, requestedBranchId) ? requestedBranchId : "__forbidden__";
}
