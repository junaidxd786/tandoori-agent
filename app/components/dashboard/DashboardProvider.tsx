"use client";

import { createContext, useContext, useMemo, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSession } from "@/lib/auth";

type SelectedBranchId = string | "all";

type DashboardContextValue = {
  session: DashboardSession;
  selectedBranchId: SelectedBranchId;
  selectedBranch:
    | {
        id: string;
        slug: string;
        name: string;
        address: string;
      }
    | null;
  setSelectedBranchId: (branchId: SelectedBranchId) => void;
  logout: () => Promise<void>;
};

const STORAGE_KEY = "tandoori-selected-branch";
const DashboardContext = createContext<DashboardContextValue | null>(null);

function getInitialBranchId(session: DashboardSession): SelectedBranchId {
  if (session.role === "admin") {
    return "all";
  }

  return session.defaultBranchId ?? session.allowedBranches[0]?.id ?? "all";
}

function resolveStoredBranchId(session: DashboardSession, rawValue: string | null): SelectedBranchId | null {
  if (!rawValue) return null;

  if (rawValue === "all") {
    return session.role === "admin" ? "all" : null;
  }

  const isAllowed = session.allowedBranches.some((branch) => branch.id === rawValue);
  return isAllowed ? rawValue : null;
}

export function DashboardProvider({
  session,
  children,
}: {
  session: DashboardSession;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selectedBranchId, setSelectedBranchIdState] = useState<SelectedBranchId>(() => {
    const fallbackBranchId = getInitialBranchId(session);
    if (typeof window === "undefined") {
      return fallbackBranchId;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    return resolveStoredBranchId(session, stored) ?? fallbackBranchId;
  });

  const selectedBranch = useMemo(() => {
    if (selectedBranchId === "all") return null;
    return session.allowedBranches.find((branch) => branch.id === selectedBranchId) ?? null;
  }, [selectedBranchId, session.allowedBranches]);

  const value = useMemo<DashboardContextValue>(() => {
    return {
      session,
      selectedBranchId,
      selectedBranch,
      setSelectedBranchId: (branchId) => {
        setSelectedBranchIdState(branchId);
        window.localStorage.setItem(STORAGE_KEY, branchId);
      },
      logout: async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        startTransition(() => {
          router.replace("/login");
          router.refresh();
        });
      },
    };
  }, [router, selectedBranch, selectedBranchId, session]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboardContext() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboardContext must be used within DashboardProvider.");
  }

  return context;
}
