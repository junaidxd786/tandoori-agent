"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Loader2, LogOut, Trash2, GitBranch, Users, ShieldAlert, Plus, ChevronRight, CheckCircle2, XCircle, Building2, Eye, Save, AlertTriangle } from "lucide-react";
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

type BranchDraft = { name: string; slug: string; address: string; is_active: "active" | "inactive" };
type StaffDraft = { full_name: string; email: string; password: string; role: "admin" | "branch_staff"; branch_id: string };

const EMPTY_BRANCH: BranchDraft = { name: "", slug: "", address: "", is_active: "active" };
const EMPTY_STAFF: StaffDraft = { full_name: "", email: "", password: "", role: "branch_staff", branch_id: "" };

async function readJson<T>(response: Response) {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body as T;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
      {children}
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-100 transition-all";
const selectCls = inputCls;

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
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);

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

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "branches", label: "Branches", icon: <GitBranch size={15} /> },
    { key: "staff", label: "Staff", icon: <Users size={15} /> },
    { key: "safety", label: "Danger Zone", icon: <ShieldAlert size={15} /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50/50 pb-16">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-zinc-950 mb-6">
        {/* Subtle grid texture */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
          }}
        />
        {/* Orange glow */}
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-orange-500 opacity-[0.07] blur-3xl" />
        <div className="absolute -bottom-16 left-16 h-48 w-48 rounded-full bg-orange-400 opacity-[0.05] blur-3xl" />

        <div className="relative p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-orange-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
                  Admin Center
                </span>
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Branch & Staff Management</h1>
              <p className="mt-1 text-sm text-zinc-400">Full access to operational controls and user permissions.</p>
            </div>
            <button
              onClick={() => void logout()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-white/10 hover:text-white transition-all shrink-0"
            >
              <LogOut size={13} />
              Sign out
            </button>
          </div>

          {/* Metrics Row */}
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Branches", value: totals.branchCount, sub: `${branches.filter((b) => b.is_active).length} active` },
              { label: "Staff Members", value: staff.length, sub: `${staff.filter((s) => s.role === "admin").length} admins` },
              { label: "Unread Messages", value: totals.unread, sub: "across all branches" },
              { label: "Active Orders", value: totals.activeOrders, sub: "currently open" },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{m.label}</p>
                <p className="mt-1.5 text-3xl font-bold text-white">{m.value}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">{m.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 mb-6 shadow-sm">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
              tab === key
                ? key === "safety"
                  ? "bg-red-600 text-white shadow-sm"
                  : "bg-zinc-900 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* ────────── BRANCHES TAB ────────── */}
      {tab === "branches" && (
        <section className="space-y-5">
          {/* Create Branch Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
                <Plus size={15} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Create Branch</h2>
                <p className="text-xs text-slate-400">Add a new location to the network</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Branch Name">
                <input value={branchDraft.name} onChange={(e) => setBranchDraft((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. Downtown Outlet" className={inputCls} />
              </Field>
              <Field label="URL Slug">
                <input value={branchDraft.slug} onChange={(e) => setBranchDraft((c) => ({ ...c, slug: e.target.value }))} placeholder="auto-generated if empty" className={inputCls} />
              </Field>
              <Field label="Status">
                <select value={branchDraft.is_active} onChange={(e) => setBranchDraft((c) => ({ ...c, is_active: e.target.value as "active" | "inactive" }))} className={selectCls}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] items-end">
              <Field label="Address">
                <textarea value={branchDraft.address} onChange={(e) => setBranchDraft((c) => ({ ...c, address: e.target.value }))} placeholder="Full address" rows={2} className={clsx(inputCls, "resize-none")} />
              </Field>
              <button
                onClick={async () => {
                  setCreatingBranch(true);
                  try {
                    await readJson(
                      await fetch("/api/admin/branches", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          ...branchDraft,
                          is_active: branchDraft.is_active === "active",
                          slug: branchDraft.slug || null,
                        }),
                      }),
                    );
                    setBranchDraft(EMPTY_BRANCH);
                    toast.success("Branch created successfully.");
                    await loadData();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to create branch.");
                  } finally {
                    setCreatingBranch(false);
                  }
                }}
                disabled={creatingBranch || !branchDraft.name.trim()}
                className="h-[72px] min-w-[140px] rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                {creatingBranch ? <Loader2 size={16} className="animate-spin" /> : <><Plus size={14} /> Create Branch</>}
              </button>
            </div>
          </div>

          {/* Branches List */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">Manage Branches</h2>
                <p className="text-xs text-slate-400 mt-0.5">{branches.length} branch{branches.length !== 1 ? "es" : ""} total</p>
              </div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                {branches.filter((b) => b.is_active).length} Active
              </span>
            </div>

            {loading && (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-50" />
                ))}
              </div>
            )}

            {!loading && branches.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Building2 size={32} className="text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-400">No branches yet</p>
                <p className="text-xs text-slate-300 mt-1">Create your first branch above</p>
              </div>
            )}

            {!loading && branches.map((branch, idx) => {
              const isExpanded = expandedBranch === branch.id;
              const isSaving = savingBranchId === branch.id;
              return (
                <div key={branch.id} className={clsx("border-slate-100", idx < branches.length - 1 && "border-b")}>
                  {/* Collapsed Row */}
                  <div
                    className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors group"
                    onClick={() => setExpandedBranch(isExpanded ? null : branch.id)}
                  >
                    <div className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold", branch.is_active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-400")}>
                      {branch.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 truncate">{branch.name}</p>
                        <span className={clsx("shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", branch.is_active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500")}>
                          {branch.is_active ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                          {branch.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">{branch.address || "No address"}</p>
                    </div>
                    <div className="hidden md:flex items-center gap-3 text-xs text-slate-400 shrink-0">
                      <span className="rounded-md bg-slate-100 px-2.5 py-1 font-medium">{branch.stats.conversations} chats</span>
                      <span className="rounded-md bg-orange-50 text-orange-700 px-2.5 py-1 font-medium">{branch.stats.activeOrders} orders</span>
                      <span className="rounded-md bg-slate-100 px-2.5 py-1 font-medium">{branch.stats.menuItems} items</span>
                    </div>
                    <ChevronRight size={16} className={clsx("text-slate-300 group-hover:text-slate-500 transition-all shrink-0", isExpanded && "rotate-90")} />
                  </div>

                  {/* Expanded Edit Panel */}
                  {isExpanded && (
                    <div className="px-6 pb-5 bg-slate-50/50 border-t border-slate-100">
                      <div className="pt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Field label="Branch Name">
                          <input value={branch.name} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, name: e.target.value } : b))} className={inputCls} />
                        </Field>
                        <Field label="Slug">
                          <input value={branch.slug} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, slug: e.target.value } : b))} className={inputCls} />
                        </Field>
                        <Field label="Status">
                          <select value={branch.is_active ? "active" : "inactive"} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, is_active: e.target.value === "active" } : b))} className={selectCls}>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </Field>
                        <Field label="Address">
                          <input value={branch.address} onChange={(e) => setBranches((c) => c.map((b) => b.id === branch.id ? { ...b, address: e.target.value } : b))} className={inputCls} />
                        </Field>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => setSelectedBranchId(branch.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                        >
                          <Eye size={12} /> Focus Branch
                        </button>
                        <button
                          onClick={async () => {
                            setSavingBranchId(branch.id);
                            try {
                              await readJson(await fetch(`/api/admin/branches/${branch.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: branch.name, slug: branch.slug, address: branch.address, is_active: branch.is_active }) }));
                              toast.success("Branch saved.");
                              await loadData();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to save branch.");
                            } finally {
                              setSavingBranchId(null);
                            }
                          }}
                          disabled={isSaving}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                        >
                          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          Save Changes
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Delete "${branch.name}"? This action cannot be undone.`)) return;
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
                          disabled={isSaving}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors ml-auto"
                        >
                          <Trash2 size={12} /> Delete Branch
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ────────── STAFF TAB ────────── */}
      {tab === "staff" && (
        <section className="space-y-5">
          {/* Create Staff Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
                <Plus size={15} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Create Staff Account</h2>
                <p className="text-xs text-slate-400">Add a new team member with role-based access</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full Name">
                <input value={staffDraft.full_name} onChange={(e) => setStaffDraft((c) => ({ ...c, full_name: e.target.value }))} placeholder="Jane Smith" className={inputCls} />
              </Field>
              <Field label="Email Address">
                <input type="email" value={staffDraft.email} onChange={(e) => setStaffDraft((c) => ({ ...c, email: e.target.value }))} placeholder="jane@company.com" className={inputCls} />
              </Field>
              <Field label="Initial Password">
                <input type="password" value={staffDraft.password} onChange={(e) => setStaffDraft((c) => ({ ...c, password: e.target.value }))} placeholder="Minimum 8 characters" className={inputCls} />
              </Field>
              <Field label="Role">
                <select value={staffDraft.role} onChange={(e) => setStaffDraft((c) => ({ ...c, role: e.target.value as "admin" | "branch_staff", branch_id: e.target.value === "admin" ? "" : c.branch_id }))} className={selectCls}>
                  <option value="branch_staff">Branch Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              {staffDraft.role === "branch_staff" && (
                <div className="md:col-span-2">
                  <Field label="Assigned Branch">
                    <select value={staffDraft.branch_id} onChange={(e) => setStaffDraft((c) => ({ ...c, branch_id: e.target.value }))} className={selectCls}>
                      <option value="">Select a branch…</option>
                      {branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              {staffDraft.role === "admin" && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Admin accounts have full system access
                </p>
              )}
              <div className="ml-auto">
                <button
                  onClick={async () => {
                    setCreatingStaff(true);
                    try {
                      await readJson(await fetch("/api/admin/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: staffDraft.full_name, email: staffDraft.email, password: staffDraft.password, role: staffDraft.role, default_branch_id: staffDraft.role === "branch_staff" ? staffDraft.branch_id : null, branch_ids: staffDraft.role === "branch_staff" && staffDraft.branch_id ? [staffDraft.branch_id] : [] }) }));
                      setStaffDraft(EMPTY_STAFF);
                      toast.success("Staff account created.");
                      await loadData();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Failed to create staff.");
                    } finally {
                      setCreatingStaff(false);
                    }
                  }}
                  disabled={creatingStaff || !staffDraft.full_name.trim() || !staffDraft.email.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors"
                >
                  {creatingStaff ? <Loader2 size={14} className="animate-spin" /> : <><Plus size={14} /> Create Account</>}
                </button>
              </div>
            </div>
          </div>

          {/* Staff List */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">Staff Directory</h2>
                <p className="text-xs text-slate-400 mt-0.5">{staff.length} member{staff.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="rounded-full bg-purple-50 text-purple-700 px-2.5 py-1 font-semibold">{staff.filter((s) => s.role === "admin").length} admins</span>
                <span className="rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 font-semibold">{staff.filter((s) => s.role === "branch_staff").length} staff</span>
              </div>
            </div>

            {loading && (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-50" />)}
              </div>
            )}

            {!loading && staff.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users size={32} className="text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-400">No staff accounts yet</p>
              </div>
            )}

            {!loading && staff.map((member, idx) => {
              const assignedBranchId = member.allowed_branch_ids[0] ?? "";
              const isExpanded = expandedStaff === member.user_id;
              const isSaving = savingStaffId === member.user_id;
              const isSelf = member.user_id === session.userId;
              const initials = (member.full_name || member.email || "?").slice(0, 2).toUpperCase();
              const branchName = branches.find((b) => b.id === assignedBranchId)?.name;

              return (
                <div key={member.user_id} className={clsx("border-slate-100", idx < staff.length - 1 && "border-b")}>
                  {/* Collapsed Row */}
                  <div
                    className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors group"
                    onClick={() => setExpandedStaff(isExpanded ? null : member.user_id)}
                  >
                    <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", member.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-50 text-blue-700")}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900 truncate">{member.full_name || "Unnamed"}</p>
                        {isSelf && <span className="text-[10px] font-semibold rounded-full bg-orange-50 text-orange-600 px-2 py-0.5">You</span>}
                        <span className={clsx("text-[10px] font-semibold rounded-full px-2 py-0.5", member.role === "admin" ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-600")}>
                          {member.role === "admin" ? "Admin" : "Branch Staff"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {member.email || "No email"}{branchName ? ` · ${branchName}` : ""}
                      </p>
                    </div>
                    <ChevronRight size={16} className={clsx("text-slate-300 group-hover:text-slate-500 transition-all shrink-0", isExpanded && "rotate-90")} />
                  </div>

                  {/* Expanded Edit Panel */}
                  {isExpanded && (
                    <div className="px-6 pb-5 bg-slate-50/50 border-t border-slate-100">
                      <div className="pt-5 grid gap-4 md:grid-cols-3">
                        <Field label="Full Name">
                          <input value={member.full_name ?? ""} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, full_name: e.target.value } : s))} className={inputCls} />
                        </Field>
                        <div>
                          <FieldLabel>Email Address</FieldLabel>
                          <div className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-400 cursor-not-allowed select-none truncate">
                            {member.email || "No email"}
                          </div>
                        </div>
                        <Field label="Role">
                          <select value={member.role} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, role: e.target.value as "admin" | "branch_staff", allowed_branch_ids: e.target.value === "admin" ? [] : s.allowed_branch_ids, default_branch_id: e.target.value === "admin" ? null : s.default_branch_id } : s))} className={selectCls} disabled={isSelf}>
                            <option value="branch_staff">Branch Staff</option>
                            <option value="admin">Admin</option>
                          </select>
                        </Field>
                      </div>

                      {member.role === "branch_staff" && (
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <Field label="Assigned Branch">
                            <select value={assignedBranchId} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, allowed_branch_ids: e.target.value ? [e.target.value] : [], default_branch_id: e.target.value || null } : s))} className={selectCls}>
                              <option value="">No branch assigned</option>
                              {branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          </Field>
                          <Field label="Default Branch">
                            <select value={member.default_branch_id ?? ""} onChange={(e) => setStaff((c) => c.map((s) => s.user_id === member.user_id ? { ...s, default_branch_id: e.target.value || null } : s))} className={selectCls}>
                              <option value="">Same as assigned</option>
                              {branches.filter((b) => b.id === assignedBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          </Field>
                        </div>
                      )}

                      <div className="mt-4">
                        <Field label="New Password (optional)">
                          <input type="password" value={passwordDrafts[member.user_id] ?? ""} onChange={(e) => setPasswordDrafts((c) => ({ ...c, [member.user_id]: e.target.value }))} placeholder="Leave blank to keep current password" className={clsx(inputCls, "md:max-w-xs")} />
                        </Field>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-2">
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
                          disabled={isSaving}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                        >
                          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          Save Changes
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Delete account for "${member.full_name || member.email}"? This cannot be undone.`)) return;
                            setSavingStaffId(member.user_id);
                            try {
                              await readJson(await fetch(`/api/admin/staff/${member.user_id}`, { method: "DELETE" }));
                              toast.success("Staff account deleted.");
                              await loadData();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to delete staff.");
                            } finally {
                              setSavingStaffId(null);
                            }
                          }}
                          disabled={isSaving || isSelf}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-auto"
                          title={isSelf ? "You cannot delete your own account" : undefined}
                        >
                          <Trash2 size={12} /> Delete Account
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ────────── SAFETY TAB ────────── */}
      {tab === "safety" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Danger Zone</h2>
                <p className="mt-1 text-sm text-slate-500">
                  These actions permanently delete operational data and cannot be reversed. Make sure you have a backup before proceeding.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {/* Wipe All */}
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-red-900">Wipe All Operational Data</p>
                    <p className="text-xs text-red-600 mt-1">Clears all conversations, orders, and messages across every branch. Staff accounts and menu configuration are preserved.</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!window.confirm("This will permanently wipe ALL operational data across every branch. Are you absolutely sure?")) return;
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
                    className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-600 hover:text-white hover:border-red-600 disabled:opacity-50 transition-all"
                  >
                    {resetting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Wipe All Data
                  </button>
                </div>
              </div>

              {/* Wipe Selected Branch */}
              {selectedBranchId !== "all" && (
                <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-orange-900">Wipe Branch: {selectedBranch?.name || "Selected Branch"}</p>
                      <p className="text-xs text-orange-600 mt-1">Clears all operational data for this branch only. Other branches are unaffected.</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Wipe all data for "${selectedBranch?.name || "this branch"}"?`)) return;
                        setResetting(true);
                        try {
                          await readJson(await fetch("/api/admin/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch_id: selectedBranchId }) }));
                          toast.success("Branch data cleared.");
                          await loadData();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Failed to clear data.");
                        } finally {
                          setResetting(false);
                        }
                      }}
                      disabled={resetting}
                      className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 transition-all"
                    >
                      {resetting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Wipe Branch
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}