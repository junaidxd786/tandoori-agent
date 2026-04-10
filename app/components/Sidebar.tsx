"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MessageSquare,
  ShoppingBag,
  LayoutDashboard,
  UtensilsCrossed,
  Settings,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";

const baseNavItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/menu", label: "Menu Editor", icon: UtensilsCrossed },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];
const adminNavItems = [...baseNavItems, { href: "/dashboard/admin", label: "Admin", icon: Users }];

function buildBranchQuery(branchId: string | "all") {
  return branchId === "all" ? "" : `&branch_id=${encodeURIComponent(branchId)}`;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, selectedBranchId, selectedBranch, setSelectedBranchId, logout } = useDashboardContext();
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "Tandoori Hub";
  const [firstWord, ...rest] = appName.split(" ");
  const navItems = session.role === "admin" ? adminNavItems : baseNavItems;

  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const notifiedSetRef = useRef<Set<string>>(new Set());

  const playNotificationSound = () => {
    try {
      const AudioContextClass = window.AudioContext || ("webkitAudioContext" in window ? window.webkitAudioContext : undefined);
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch (error) {
      console.error("Audio error", error);
    }
  };

  useEffect(() => {
    navItems.forEach((item) => {
      router.prefetch(item.href);
    });
  }, [navItems, router]);

  useEffect(() => {
    const checkNotifications = async () => {
      try {
        const res = await fetch(`/api/conversations?limit=100${buildBranchQuery(selectedBranchId)}`, {
          cache: "no-store",
          headers: { "ngrok-skip-browser-warning": "69420" }
        });
        if (!res.ok) return;
        const data = await res.json();

        let currentUnread = 0;
        const currentUnreadIds = new Set<string>();

        for (const conv of data) {
          if (conv.has_unread) {
            currentUnread++;
            currentUnreadIds.add(conv.id);

            if (!notifiedSetRef.current.has(conv.id)) {
              notifiedSetRef.current.add(conv.id);
              playNotificationSound();

              const latestMsg = conv.messages?.[0]?.content || 'New message!';
              toast.message(`New message from ${conv.name || conv.phone}`, {
                description: latestMsg.length > 50 ? latestMsg.slice(0, 50) + '...' : latestMsg
              });
            }
          }
        }

        for (const id of Array.from(notifiedSetRef.current)) {
          if (!currentUnreadIds.has(id)) {
            notifiedSetRef.current.delete(id);
          }
        }
        setGlobalUnreadCount(currentUnread);
      } catch {
        // Silent retry on next polling tick.
      }
    };

    void checkNotifications();
    const interval = window.setInterval(() => void checkNotifications(), 12000);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedBranchId]);

  return (
    // Dark mode sidebar
    <aside className="w-64 border-r border-zinc-900 bg-zinc-950 flex flex-col h-screen sticky top-0 z-20 shadow-2xl">

      <div className="px-6 py-6 border-b border-zinc-800/60">
        <Link href="/dashboard" className="flex items-center gap-3.5 group">
          <div className="w-12 h-12 rounded-xl overflow-hidden border border-zinc-800 flex-shrink-0 transition-transform duration-300 group-hover:scale-105 active:scale-95 shadow-md shadow-black/40 bg-zinc-900 p-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt={`${appName} logo`}
              className="w-full h-full object-cover rounded-lg"
            />
          </div>
          <div>
            <p className="text-base font-bold text-white tracking-tight leading-none">
              {firstWord} <span className="text-brand">{rest.join(" ")}</span>
            </p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1.5">
              Management Hub
            </p>
          </div>
        </Link>
      </div>

      <div className="px-4 pt-4">
        <label className="block rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            Active Branch
          </span>
          {session.role === "admin" ? (
            <select
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value as string | "all")}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-100 outline-none focus:border-brand"
            >
              <option value="all">All branches</option>
              {session.allowedBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-semibold text-zinc-100">
              {selectedBranch?.name || session.allowedBranches[0]?.name || "Assigned branch"}
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            {selectedBranch
              ? selectedBranch.address
              : session.role === "admin"
                ? "Admin overview across all branches"
                : "Branch is assigned by admin"}
          </p>
        </label>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={clsx(
                "relative flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-medium transition-all group overflow-hidden",
                isActive
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/50"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon
                  size={18}
                  className={clsx(
                    "transition-colors",
                    isActive ? "text-brand" : "text-zinc-500 group-hover:text-zinc-300"
                  )}
                />
                <span className="flex items-center gap-2">
                  {label}
                  {href === "/dashboard/conversations" && globalUnreadCount > 0 && (
                    <span className="bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                      {globalUnreadCount}
                    </span>
                  )}
                </span>
              </div>

              {/* Active dot indicator */}
              {isActive && (
                <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-brand shadow-[0_0_8px_rgba(234,88,12,0.6)]" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800/70 p-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
              <ShieldCheck size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight text-white break-words">
                {session.fullName || session.email || "Staff User"}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                {session.role === "admin" ? "Admin" : "Branch Staff"}
              </p>
            </div>
          </div>

          <button
            onClick={() => void logout()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
          >
            <LogOut size={15} />
            Sign Out
          </button>
        </div>
      </div>
    </aside>
  );
}
