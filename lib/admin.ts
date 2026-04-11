import { supabaseAdmin } from "./supabase-admin";
import type { StaffRole } from "./auth";

export type AdminBranchSummary = {
  id: string;
  slug: string;
  name: string;
  address: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  stats: {
    conversations: number;
    unread: number;
    activeOrders: number;
    menuItems: number;
  };
};

export type AdminStaffSummary = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: StaffRole;
  default_branch_id: string | null;
  allowed_branch_ids: string[];
  created_at: string;
  updated_at: string;
};

type CreateStaffInput = {
  email: string;
  password: string;
  fullName: string;
  role: StaffRole;
  defaultBranchId: string | null;
  branchIds: string[];
};

type UpdateStaffInput = {
  fullName: string;
  role: StaffRole;
  defaultBranchId: string | null;
  branchIds: string[];
  password?: string | null;
};

type BranchMutationInput = {
  name: string;
  slug?: string | null;
  address: string;
  isActive?: boolean;
};

export function slugifyBranchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeBranchIds(branchIds: string[]) {
  return Array.from(new Set(branchIds.map((value) => value.trim()).filter(Boolean)));
}

function normalizeStaffPayload(input: CreateStaffInput | UpdateStaffInput) {
  const role = input.role;
  const branchIds = normalizeBranchIds(input.branchIds);
  const defaultBranchId = input.defaultBranchId?.trim() || null;

  if (role === "branch_staff" && branchIds.length !== 1) {
    throw new Error("Branch staff must have exactly one assigned branch.");
  }

  if (defaultBranchId && role === "branch_staff" && !branchIds.includes(defaultBranchId)) {
    throw new Error("Default branch must be one of the allowed branches for branch staff.");
  }

  return {
    role,
    branchIds,
    defaultBranchId: role === "branch_staff" ? defaultBranchId ?? branchIds[0] ?? null : defaultBranchId,
  };
}

async function replaceBranchAssignments(userId: string, branchIds: string[]) {
  const { error: deleteError } = await supabaseAdmin
    .from("staff_branch_access")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    throw deleteError;
  }

  if (branchIds.length === 0) {
    return;
  }

  const { error: insertError } = await supabaseAdmin.from("staff_branch_access").insert(
    branchIds.map((branchId) => ({
      user_id: userId,
      branch_id: branchId,
    })),
  );

  if (insertError) {
    throw insertError;
  }
}

export async function listBranchesWithStats(): Promise<AdminBranchSummary[]> {
  const [{ data: branches, error: branchError }, { data: conversations, error: conversationError }, { data: orders, error: orderError }, { data: menuItems, error: menuError }] =
    await Promise.all([
      supabaseAdmin
        .from("branches")
        .select("id, slug, name, address, is_active, created_at, updated_at")
        .order("name", { ascending: true }),
      supabaseAdmin.from("conversations").select("branch_id, has_unread"),
      supabaseAdmin.from("orders").select("branch_id, status"),
      supabaseAdmin.from("menu_items").select("branch_id"),
    ]);

  if (branchError) throw branchError;
  if (conversationError) throw conversationError;
  if (orderError) throw orderError;
  if (menuError) throw menuError;

  return (branches ?? []).map((branch) => {
    const branchConversations = (conversations ?? []).filter((item) => item.branch_id === branch.id);
    const branchOrders = (orders ?? []).filter((item) => item.branch_id === branch.id);
    const branchMenu = (menuItems ?? []).filter((item) => item.branch_id === branch.id);

    return {
      ...branch,
      stats: {
        conversations: branchConversations.length,
        unread: branchConversations.filter((item) => item.has_unread).length,
        activeOrders: branchOrders.filter((item) =>
          ["received", "preparing", "out_for_delivery"].includes(item.status),
        ).length,
        menuItems: branchMenu.length,
      },
    };
  });
}

export async function createBranch(input: BranchMutationInput) {
  const name = input.name.trim();
  const address = input.address.trim();
  const slug = slugifyBranchName(input.slug?.trim() || input.name);

  if (!name) throw new Error("Branch name is required.");
  if (!slug) throw new Error("Branch slug is required.");
  if (!address) throw new Error("Branch address is required.");

  const { data, error } = await supabaseAdmin
    .from("branches")
    .insert({
      name,
      slug,
      address,
      is_active: input.isActive ?? true,
    })
    .select("id, slug, name, address, is_active, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to create branch.");
  }

  const { error: settingsError } = await supabaseAdmin
    .from("restaurant_settings")
    .insert({ branch_id: data.id })
    .select("branch_id")
    .maybeSingle();

  if (settingsError) {
    throw settingsError;
  }

  return data;
}

export async function updateBranch(branchId: string, input: BranchMutationInput) {
  const name = input.name.trim();
  const address = input.address.trim();
  const slug = slugifyBranchName(input.slug?.trim() || input.name);

  if (!name) throw new Error("Branch name is required.");
  if (!slug) throw new Error("Branch slug is required.");
  if (!address) throw new Error("Branch address is required.");

  const { data, error } = await supabaseAdmin
    .from("branches")
    .update({
      name,
      slug,
      address,
      is_active: input.isActive ?? true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", branchId)
    .select("id, slug, name, address, is_active, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to update branch.");
  }

  return data;
}

export async function deleteBranch(branchId: string) {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("branches")
    .select("id, name")
    .eq("id", branchId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!existing) {
    throw new Error("Branch not found.");
  }

  // Explicit cleanup before branch deletion keeps behavior deterministic even if
  // live DB constraints differ from local schema expectations.
  const { error: accessError } = await supabaseAdmin
    .from("staff_branch_access")
    .delete()
    .eq("branch_id", branchId);
  if (accessError) throw accessError;

  const { error: profileError } = await supabaseAdmin
    .from("staff_profiles")
    .update({ default_branch_id: null })
    .eq("default_branch_id", branchId);
  if (profileError) throw profileError;

  const { error: contactsError } = await supabaseAdmin
    .from("contacts")
    .update({ active_branch_id: null })
    .eq("active_branch_id", branchId);
  if (contactsError) throw contactsError;

  const { error: settingsError } = await supabaseAdmin
    .from("restaurant_settings")
    .delete()
    .eq("branch_id", branchId);
  if (settingsError) throw settingsError;

  const { error: deleteError } = await supabaseAdmin
    .from("branches")
    .delete()
    .eq("id", branchId);

  if (deleteError) {
    throw deleteError;
  }
}

export async function listStaffMembers(): Promise<AdminStaffSummary[]> {
  const [{ data: profiles, error: profileError }, { data: assignments, error: assignmentError }, usersResult] = await Promise.all([
    supabaseAdmin
      .from("staff_profiles")
      .select("user_id, full_name, role, default_branch_id, created_at, updated_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("staff_branch_access").select("user_id, branch_id"),
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profileError) {
    throw profileError;
  }

  if (assignmentError) {
    throw assignmentError;
  }

  if (usersResult.error) {
    throw usersResult.error;
  }

  const emailByUserId = new Map(
    (usersResult.data.users ?? []).map((user) => [user.id, user.email ?? null]),
  );
  const branchIdsByUserId = new Map<string, string[]>();
  for (const row of assignments ?? []) {
    const existing = branchIdsByUserId.get(row.user_id) ?? [];
    existing.push(row.branch_id);
    branchIdsByUserId.set(row.user_id, existing);
  }

  return (profiles ?? []).map((profile) => ({
    user_id: profile.user_id,
    email: emailByUserId.get(profile.user_id) ?? null,
    full_name: profile.full_name,
    role: profile.role,
    default_branch_id: profile.default_branch_id,
    allowed_branch_ids: branchIdsByUserId.get(profile.user_id) ?? [],
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  }));
}

export async function createStaffAccount(input: CreateStaffInput) {
  const email = input.email.trim().toLowerCase();
  const password = input.password.trim();
  const fullName = input.fullName.trim();

  if (!email) throw new Error("Email is required.");
  if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");
  if (!fullName) throw new Error("Full name is required.");

  const normalized = normalizeStaffPayload(input);
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  });

  if (created.error || !created.data.user) {
    throw created.error ?? new Error("Failed to create auth user.");
  }

  const userId = created.data.user.id;
  const { error: profileError } = await supabaseAdmin.from("staff_profiles").upsert(
    {
      user_id: userId,
      full_name: fullName,
      role: normalized.role,
      default_branch_id: normalized.defaultBranchId,
    },
    { onConflict: "user_id" },
  );

  if (profileError) {
    throw profileError;
  }

  await replaceBranchAssignments(userId, normalized.role === "admin" ? [] : normalized.branchIds);
  return userId;
}

export async function updateStaffAccount(userId: string, input: UpdateStaffInput) {
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Full name is required.");

  const normalized = normalizeStaffPayload(input);
  const { error: profileError } = await supabaseAdmin.from("staff_profiles").upsert(
    {
      user_id: userId,
      full_name: fullName,
      role: normalized.role,
      default_branch_id: normalized.defaultBranchId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (profileError) {
    throw profileError;
  }

  await replaceBranchAssignments(userId, normalized.role === "admin" ? [] : normalized.branchIds);

  const password = input.password?.trim();
  if (password) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (authError) {
      throw authError;
    }
  }
}

export async function deleteStaffAccount(userId: string) {
  const { error: branchAccessError } = await supabaseAdmin
    .from("staff_branch_access")
    .delete()
    .eq("user_id", userId);
  if (branchAccessError) throw branchAccessError;

  const { error: profileError } = await supabaseAdmin
    .from("staff_profiles")
    .delete()
    .eq("user_id", userId);
  if (profileError) throw profileError;

  const deleted = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleted.error) throw deleted.error;
}

async function deleteOrphanContacts() {
  const { data: contacts, error: contactsError } = await supabaseAdmin
    .from("contacts")
    .select("id, active_branch_id");

  if (contactsError) {
    throw contactsError;
  }

  const { data: conversations, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .select("contact_id");

  if (conversationError) {
    throw conversationError;
  }

  const usedContactIds = new Set((conversations ?? []).map((item) => item.contact_id).filter(Boolean));
  const orphanIds = (contacts ?? [])
    .filter((contact) => !contact.active_branch_id && !usedContactIds.has(contact.id))
    .map((contact) => contact.id);

  if (orphanIds.length === 0) {
    return;
  }

  const { error: deleteError } = await supabaseAdmin.from("contacts").delete().in("id", orphanIds);
  if (deleteError) {
    throw deleteError;
  }
}

export async function wipeOperationalData(options: { branchId?: string | null } = {}) {
  const branchId = options.branchId ?? null;

  if (branchId) {
    await supabaseAdmin.from("orders").delete().eq("branch_id", branchId);
    await supabaseAdmin.from("menu_uploads").delete().eq("branch_id", branchId);
    await supabaseAdmin.from("menu_items").delete().eq("branch_id", branchId);
    await supabaseAdmin.from("conversations").delete().eq("branch_id", branchId);
    await supabaseAdmin.from("contacts").update({ active_branch_id: null }).eq("active_branch_id", branchId);
    await deleteOrphanContacts();
    return;
  }

  await supabaseAdmin.from("orders").delete().neq("id", "");
  await supabaseAdmin.from("menu_uploads").delete().neq("id", "");
  await supabaseAdmin.from("menu_items").delete().neq("id", "");
  await supabaseAdmin.from("conversations").delete().neq("id", "");
  await supabaseAdmin.from("contacts").delete().neq("id", "");
}
