"use client";

import { useEffect, useState } from "react";
import { Bot, Clock, Phone, RefreshCw, Save, Store, Truck } from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { toast } from "sonner";

type SettingsState = {
  is_accepting_orders: boolean;
  opening_time: string;
  closing_time: string;
  delivery_enabled: boolean;
  delivery_fee: number;
  min_delivery_amount: number;
  city: string;
  phone_delivery: string;
  phone_dine_in: string;
  ai_personality: string;
};

const CITY_OPTIONS = ["Wah Cantt", "Rawalpindi", "Islamabad", "Lahore", "Karachi", "Peshawar"] as const;
const AI_PERSONALITY_PRESETS = [
  "Warm & Professional",
  "Friendly & Casual",
  "Fast & Direct",
  "Premium & Polished",
] as const;

function toTimeInputValue(value: string): string {
  const normalized = value.trim();
  const twelveHour = normalized.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (twelveHour) {
    let hours = Number.parseInt(twelveHour[1], 10) % 12;
    const minutes = Number.parseInt(twelveHour[2], 10);
    if (twelveHour[3].toUpperCase() === "PM") hours += 12;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : "";
}

function toMeridiemLabel(value: string): string {
  const [rawHours, rawMinutes] = value.split(":").map(Number);
  const period = rawHours >= 12 ? "PM" : "AM";
  const displayHours = rawHours % 12 === 0 ? 12 : rawHours % 12;
  return `${displayHours}:${String(rawMinutes).padStart(2, "0")} ${period}`;
}

export default function SettingsPage() {
  const { selectedBranchId, selectedBranch } = useDashboardContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsState>({
    is_accepting_orders: true,
    opening_time: "10:00 AM",
    closing_time: "11:00 PM",
    delivery_enabled: false,
    delivery_fee: 0,
    min_delivery_amount: 0,
    city: "",
    phone_delivery: "",
    phone_dine_in: "",
    ai_personality: "",
  });
  const selectedCityOption = CITY_OPTIONS.includes(settings.city as (typeof CITY_OPTIONS)[number])
    ? settings.city
    : "__custom__";
  const selectedPersonalityOption = AI_PERSONALITY_PRESETS.includes(
    settings.ai_personality as (typeof AI_PERSONALITY_PRESETS)[number],
  )
    ? settings.ai_personality
    : "__custom__";

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        if (selectedBranchId === "all") {
          setLoading(false);
          return;
        }

        const response = await fetch(`/api/settings?branch_id=${encodeURIComponent(selectedBranchId)}`);
        const data = (await response.json()) as Partial<SettingsState>;
        if (!cancelled) {
          setSettings((current) => ({ ...current, ...data }));
        }
      } catch {
        if (!cancelled) {
          toast.error("Failed to load settings");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [selectedBranchId]);

  async function save() {
    if (selectedBranchId === "all") return;

    setSaving(true);
    try {
      const response = await fetch(`/api/settings?branch_id=${encodeURIComponent(selectedBranchId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error("Save failed");
      }

      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6 pb-8">
      {selectedBranchId === "all" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Select a single branch from the sidebar to edit its settings.
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-500 mt-1">
            {selectedBranch
              ? `These rules apply to ${selectedBranch.name}.`
              : "These rules directly control whether the agent can accept and place orders."}
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || selectedBranchId === "all"}
          className="flex items-center gap-2 bg-brand text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition hover:bg-brand-hover disabled:opacity-50 shadow-sm shadow-orange-200"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card icon={<Store size={16} />} title="Store Status">
          <SettingRow label="Accept Orders">
            <Toggle
              value={settings.is_accepting_orders}
              onToggle={() => setSettings((current) => ({ ...current, is_accepting_orders: !current.is_accepting_orders }))}
              color="bg-emerald-500"
            />
          </SettingRow>
          <StatusBadge
            active={settings.is_accepting_orders}
            color="emerald"
            text="Manual override is ON. The agent may accept orders during open hours."
          />
          <StatusBadge
            active={!settings.is_accepting_orders}
            color="orange"
            text="Manual override is OFF. The agent will stay closed even during business hours."
          />
        </Card>

        <Card icon={<Clock size={16} />} title="Business Hours">
          <SettingRow label="Opens">
            <input
              type="time"
              value={toTimeInputValue(settings.opening_time)}
              onChange={(event) =>
                event.target.value
                  ? setSettings((current) => ({ ...current, opening_time: toMeridiemLabel(event.target.value) }))
                  : null
              }
              className="w-32 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none"
            />
          </SettingRow>
          <SettingRow label="Closes">
            <input
              type="time"
              value={toTimeInputValue(settings.closing_time)}
              onChange={(event) =>
                event.target.value
                  ? setSettings((current) => ({ ...current, closing_time: toMeridiemLabel(event.target.value) }))
                  : null
              }
              className="w-32 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none"
            />
          </SettingRow>
          <p className="text-xs text-slate-400 mt-2 px-1 font-medium">Saved in restaurant local time. Overnight hours are supported.</p>
        </Card>

        <Card icon={<Truck size={16} />} title="Delivery Rules">
          <SettingRow label="Charge Delivery Fee">
            <Toggle
              value={settings.delivery_enabled}
              onToggle={() => setSettings((current) => ({ ...current, delivery_enabled: !current.delivery_enabled }))}
            />
          </SettingRow>

          <SettingRow label="Delivery Fee">
            <div className="flex items-center gap-1">
              <span className="text-sm text-slate-400">Rs.</span>
              <input
                type="number"
                min={0}
                step={10}
                value={settings.delivery_fee}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, delivery_fee: Number(event.target.value) || 0 }))
                }
                className="w-24 text-right text-sm font-bold text-slate-800 bg-transparent outline-none"
              />
            </div>
          </SettingRow>

          <SettingRow label="Minimum Delivery">
            <div className="flex items-center gap-1">
              <span className="text-sm text-slate-400">Rs.</span>
              <input
                type="number"
                min={0}
                step={50}
                value={settings.min_delivery_amount}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, min_delivery_amount: Number(event.target.value) || 0 }))
                }
                className="w-24 text-right text-sm font-bold text-slate-800 bg-transparent outline-none"
              />
            </div>
          </SettingRow>

          <StatusBadge
            active={!settings.delivery_enabled}
            color="slate"
            text="Delivery fee charging is OFF. Delivery remains free when an order is accepted."
          />
          <StatusBadge
            active={settings.delivery_enabled}
            color="orange"
            text={`Delivery fee is Rs. ${settings.delivery_fee}. Minimum delivery is Rs. ${settings.min_delivery_amount}.`}
          />
        </Card>

        <Card icon={<Phone size={16} />} title="Contact & City">
          <SettingRow label="City">
            <select
              value={selectedCityOption}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  city: event.target.value === "__custom__" ? current.city : event.target.value,
                }))
              }
              className="w-40 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none"
            >
              {CITY_OPTIONS.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
              <option value="__custom__">Custom</option>
            </select>
          </SettingRow>
          {selectedCityOption === "__custom__" ? (
            <SettingRow label="Custom City">
              <input
                type="text"
                value={settings.city}
                onChange={(event) => setSettings((current) => ({ ...current, city: event.target.value }))}
                className="w-40 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none"
              />
            </SettingRow>
          ) : null}
          <SettingRow label="Delivery Phone">
            <input
              type="text"
              value={settings.phone_delivery}
              onChange={(event) => setSettings((current) => ({ ...current, phone_delivery: event.target.value }))}
              className="w-40 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none"
            />
          </SettingRow>
          <SettingRow label="Dine-in Phone">
            <input
              type="text"
              value={settings.phone_dine_in}
              onChange={(event) => setSettings((current) => ({ ...current, phone_dine_in: event.target.value }))}
              className="w-40 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none"
            />
          </SettingRow>
        </Card>

        <Card icon={<Bot size={16} />} title="AI Tone">
          <div className="py-2.5">
            <span className="text-sm text-slate-600 font-medium">AI Personality</span>
            <select
              value={selectedPersonalityOption}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  ai_personality:
                    event.target.value === "__custom__" ? current.ai_personality : event.target.value,
                }))
              }
              className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 outline-none focus:border-brand/30 focus:ring-2 focus:ring-brand/10"
            >
              {AI_PERSONALITY_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
              <option value="__custom__">Custom</option>
            </select>
            {selectedPersonalityOption === "__custom__" ? (
              <textarea
                value={settings.ai_personality}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, ai_personality: event.target.value }))
                }
                rows={4}
                className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 outline-none focus:border-brand/30 focus:ring-2 focus:ring-brand/10"
                placeholder="Describe custom tone"
              />
            ) : null}
            <p className="mt-2 text-xs text-slate-400">
              This tone is injected into the WhatsApp assistant prompt for the selected branch.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
        <span className="text-slate-500">{icon}</span>
        <span className="text-sm font-bold text-slate-800 uppercase tracking-widest">{title}</span>
      </div>
      <div className="flex flex-col gap-0 flex-1 px-5 py-3 divide-y divide-slate-50">{children}</div>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-slate-600 font-medium">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  value,
  onToggle,
  color = "bg-brand",
}: {
  value: boolean;
  onToggle: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200",
        value ? color : "bg-slate-200",
      )}
    >
      <span
        className={clsx(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200",
          value ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function StatusBadge({
  active,
  color,
  text,
}: {
  active: boolean;
  color: "orange" | "emerald" | "slate";
  text: string;
}) {
  if (!active) return null;

  const colors = {
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
  };

  return <p className={clsx("text-xs font-medium px-3 py-1.5 rounded-lg border mt-2", colors[color])}>{text}</p>;
}
