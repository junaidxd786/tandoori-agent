"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Loader2, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDashboardContext } from "./DashboardProvider";

type Tab = "branches" | "staff" | "safety";

type BranchSummary = {
  id: string;
  slug: string;
  name: string;
  address: string;
  is_active: boolean;
  stats: {
    conversations: number;
    unread: number;
    activeOrders: number;
    menuItems: number;
  };
};

type StaffSummary = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "branch_staff";
  default_branch_id: string | null;
  allowed_branch_ids: string[];
};

type BranchDraft = { name: string; slug: string; address: string };
type StaffDraft = { full_name: string; email: string; password: string; role: "admin" | "branch_staff"; branch_id: string };

const EMPTY_BRANCH: BranchDraft = { name: "", slug: "", address: "" };
const EMPTY_STAFF: StaffDraft = { full_name: "", email: "", password: "", role: "branch_staff", branch_id: "" };

async function readJson<T>(response: Response) {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body as T;
}

export default function AdminConsole() {
  const { session, selectedBranchId, selectedBranch, setSelectedBranchId, logout } = useDashboardContext();
  const [tab, setTab] = useState<Tab>("branches");
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [savingBranchId, setSavingBranchId] = useState<string | null>(null);
  const [savingStaffId, setSavingStaffId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [branchDraft, setBranchDraft] = useState<BranchDraft>(EMPTY_BRANCH);
  const [staffDraft, setStaffDraft] = useState<StaffDraft>(EMPTY_STAFF);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});

  const totals = useMemo(() => {
    return branches.reduce(
      (acc, branch) => ({
        branchCount: acc.branchCount + 1,
        activeOrders: acc.activeOrders + branch.stats.activeOrders,
        unread: acc.unread + branch.stats.unread,
        menuItems: acc.menuItems + branch.stats.menuItems,
      }),
      { branchCount: 0, activeOrders: 0, unread: 0, menuItems: 0 },
    );
  }, [branches]);

  async function loadData() {
    setLoading(true);
    try {
      const [branchRes, staffRes] = await Promise.all([fetch("/api/admin/branches"), fetch("/api/admin/staff")]);
      const [nextBranches, nextStaff] = await Promise.all([
        readJson<BranchSummary[]>(branchRes),
        readJson<StaffSummary[]>(staffRes),
      ]);
      setBranches(nextBranches);
      setStaff(nextStaff);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  if (session.role !== "admin") return null;

  return (
    <div className="space-y-6 pb-10">
      <div className="rounded-3xl border border-slate-200 bg-zinc-950 p-6 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">Admin Center</p>
            <h1 className="mt-2 text-3xl font-bold">Branch, Staff, and Access Control</h1>
          </div>
          <button
            onClick={() => void logout()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15"
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Branches" value={String(totals.branchCount)} />
          <Metric label="Staff" value={String(staff.length)} />
          <Metric label="Unread" value={String(totals.unread)} />
          <Metric label="Active Orders" value={String(totals.activeOrders)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">
        {(["branches", "staff", "safety"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={clsx(
              "rounded-xl px-4 py-2 text-sm font-semibold capitalize",
              tab === item ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "branches" ? (
        <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold text-slate-900">Create Branch</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <input value={branchDraft.name} onChange={(e) => setBranchDraft((c) => ({ ...c, name: e.target.value }))} placeholder="Branch name" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input value={branchDraft.slug} onChange={(e) => setBranchDraft((c) => ({ ...c, slug: e.target.value }))} placeholder="Slug (optional)" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <button
                onClick={async () => {
                  setCreatingBranch(true);
                  try {
                    await readJson(
                      await fetch("/api/admin/branches", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ...branchDraft, is_active: true, slug: branchDraft.slug || null }),
                      }),
                    );
                    setBranchDraft(EMPTY_BRANCH);
                    toast.success("Branch created.");
                    await loadData();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to create branch.");
                  } finally {
                    setCreatingBranch(false);
                  }
                }}
                disabled={creatingBranch}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creatingBranch ? <Loader2 size={16} className="mx-auto animate-spin" /> : "Create Branch"}
              </button>
            </div>
            <textarea value={branchDraft.address} onChange={(e) => setBranchDraft((c) => ({ ...c, address: e.target.value }))} placeholder="Branch address" className="mt-3 min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold text-slate-900">Manage Branches</h2>
            <p className="text-sm text-slate-500">Delete branch is available on each row.</p>
            <div className="mt-4 space-y-4">
              {loading ? <div className="h-20 animate-pulse rounded-xl bg-slate-50" /> : null}
              {!loading && branches.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No branches found.</div> : null}
              {!loading && branches.map((branch) => (
                <div key={branch.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.8fr_auto]">
                    <input value={branch.name} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, name: e.target.value } : b))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input value={branch.slug} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, slug: e.target.value } : b))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input value={branch.address} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, address: e.target.value } : b))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={branch.is_active} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, is_active: e.target.checked } : b))} />Active</label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge text={`${branch.stats.conversations} chats`} />
                    <Badge text={`${branch.stats.activeOrders} active`} />
                    <Badge text={`${branch.stats.menuItems} menu`} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => setSelectedBranchId(branch.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Focus</button>
                    <button
                      onClick={async () => {
                        setSavingBranchId(branch.id);
                        try {
                          await readJson(await fetch(`/api/admin/branches/${branch.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: branch.name, slug: branch.slug, address: branch.address, is_active: branch.is_active }) }));
                          toast.success("Branch updated.");
                          await loadData();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Failed to save branch.");
                        } finally {
                          setSavingBranchId(null);
                        }
                      }}
                      disabled={savingBranchId === branch.id}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {savingBranchId === branch.id ? <Loader2 size={14} className="animate-spin" /> : "Save"}
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete "${branch.name}"?`)) return;
                        setSavingBranchId(branch.id);
                        try {
                          await readJson(await fetch(`/api/admin/branches/${branch.id}`, { method: "DELETE" }));
                          toast.success("Branch deleted.");
                          await loadData();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Failed to delete branch.");
                        } finally {
                          setSavingBranchId(null);
                        }
                      }}
                      disabled={savingBranchId === branch.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      <Trash2 size={12} /> Delete Branch
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "staff" ? (
        <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold text-slate-900">Create Staff</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input value={staffDraft.full_name} onChange={(e) => setStaffDraft((c) => ({ ...c, full_name: e.target.value }))} placeholder="Full name" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input value={staffDraft.email} onChange={(e) => setStaffDraft((c) => ({ ...c, email: e.target.value }))} placeholder="Email" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input value={staffDraft.password} onChange={(e) => setStaffDraft((c) => ({ ...c, password: e.target.value }))} placeholder="Password" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <select value={staffDraft.role} onChange={(e) => setStaffDraft((c) => ({ ...c, role: e.target.value as "admin" | "branch_staff", branch_id: e.target.value === "admin" ? "" : c.branch_id }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="branch_staff">Branch Staff</option><option value="admin">Admin</option></select>
              {staffDraft.role === "branch_staff" ? (
                <select value={staffDraft.branch_id} onChange={(e) => setStaffDraft((c) => ({ ...c, branch_id: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"><option value="">Assigned branch</option>{branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              ) : null}
            </div>
            <button
              onClick={async () => {
                setCreatingStaff(true);
                try {
                  await readJson(await fetch("/api/admin/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: staffDraft.full_name, email: staffDraft.email, password: staffDraft.password, role: staffDraft.role, default_branch_id: staffDraft.role === "branch_staff" ? staffDraft.branch_id : null, branch_ids: staffDraft.role === "branch_staff" && staffDraft.branch_id ? [staffDraft.branch_id] : [] }) }));
                  setStaffDraft(EMPTY_STAFF);
                  toast.success("Staff created.");
                  await loadData();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to create staff.");
                } finally {
                  setCreatingStaff(false);
                }
              }}
              disabled={creatingStaff}
              className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {creatingStaff ? <Loader2 size={16} className="animate-spin" /> : "Create Staff"}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold text-slate-900">Manage Staff</h2>
            <div className="mt-4 space-y-4">
              {loading ? <div className="h-20 animate-pulse rounded-xl bg-slate-50" /> : null}
              {!loading && staff.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No staff found.</div> : null}
              {!loading && staff.map((member) => {
                const assignedBranchId = member.allowed_branch_ids[0] ?? "";
                return (
                  <div key={member.user_id} className="rounded-xl border border-slate-200 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
                      <input value={member.full_name ?? ""} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, full_name: e.target.value } : s))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                      <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500">{member.email || "No email"}</div>
                      <select value={member.role} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, role: e.target.value as "admin" | "branch_staff", allowed_branch_ids: e.target.value === "admin" ? [] : s.allowed_branch_ids, default_branch_id: e.target.value === "admin" ? null : s.default_branch_id } : s))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="branch_staff">Branch Staff</option><option value="admin">Admin</option></select>
                    </div>
                    {member.role === "branch_staff" ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <select value={assignedBranchId} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, allowed_branch_ids: e.target.value ? [e.target.value] : [], default_branch_id: e.target.value || null } : s))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">Assigned branch</option>{branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                        <select value={member.default_branch_id ?? ""} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, default_branch_id: e.target.value || null } : s))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">Default branch</option>{branches.filter((b) => b.id === assignedBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <input value={passwordDrafts[member.user_id] ?? ""} onChange={(e) => setPasswordDrafts((c) => ({ ...c, [member.user_id]: e.target.value }))} placeholder="Optional new password" className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:w-64" />
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            setSavingStaffId(member.user_id);
                            try {
                              await readJson(await fetch(`/api/admin/staff/${member.user_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: member.full_name ?? "", role: member.role, default_branch_id: member.role === "branch_staff" ? member.default_branch_id ?? assignedBranchId : null, branch_ids: member.role === "branch_staff" && assignedBranchId ? [assignedBranchId] : [], password: (passwordDrafts[member.user_id] || "").trim() || null }) }));
                              setPasswordDrafts((c) => ({ ...c, [member.user_id]: "" }));
                              toast.success("Staff updated.");
                              await loadData();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to update staff.");
                            } finally {
                              setSavingStaffId(null);
                            }
                          }}
                          disabled={savingStaffId === member.user_id}
                          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {savingStaffId === member.user_id ? <Loader2 size={14} className="animate-spin" /> : "Save"}
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Delete "${member.full_name || member.email}"?`)) return;
                            setSavingStaffId(member.user_id);
                            try {
                              await readJson(await fetch(`/api/admin/staff/${member.user_id}`, { method: "DELETE" }));
                              toast.success("Staff deleted.");
                              await loadData();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to delete staff.");
                            } finally {
                              setSavingStaffId(null);
                            }
                          }}
                          disabled={savingStaffId === member.user_id || member.user_id === session.userId}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "safety" ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-lg font-bold text-slate-900">Danger Zone</h2>
          <p className="mt-1 text-sm text-slate-600">Clear operational data when you want a fresh start.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={async () => {
                if (!window.confirm("Wipe all operational data across all branches?")) return;
                setResetting(true);
                try {
                  await readJson(await fetch("/api/admin/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch_id: null }) }));
                  toast.success("All operational data cleared.");
                  await loadData();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to clear data.");
                } finally {
                  setResetting(false);
                }
              }}
              disabled={resetting}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
            >
              {resetting ? "Working..." : "Wipe All Data"}
            </button>
            {selectedBranchId !== "all" ? (
              <button
                onClick={async () => {
                  if (!window.confirm(`Wipe selected branch data for "${selectedBranch?.name || "branch"}"?`)) return;
                  setResetting(true);
                  try {
                    await readJson(await fetch("/api/admin/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch_id: selectedBranchId }) }));
                    toast.success("Selected branch data cleared.");
                    await loadData();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to clear data.");
                  } finally {
                    setResetting(false);
                  }
                }}
                disabled={resetting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {resetting ? "Working..." : `Wipe ${selectedBranch?.name || "Selected Branch"}`}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function Badge({ text }: { text: string }) {
  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{text}</span>;
}
