"use client";

import { useEffect, useState } from "react";
import { Clock, RefreshCw, Save, Store, Truck } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";

type SettingsState = {
  is_accepting_orders: boolean;
  opening_time: string;
  closing_time: string;
  delivery_enabled: boolean;
  delivery_fee: number;
  min_delivery_amount: number;
};

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsState>({
    is_accepting_orders: true,
    opening_time: "10:00 AM",
    closing_time: "11:00 PM",
    delivery_enabled: false,
    delivery_fee: 0,
    min_delivery_amount: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
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
  }, []);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-500 mt-1">These rules directly control whether the agent can accept and place orders.</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
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
              type="text"
              value={settings.opening_time}
              onChange={(event) => setSettings((current) => ({ ...current, opening_time: event.target.value }))}
              className="w-28 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none"
            />
          </SettingRow>
          <SettingRow label="Closes">
            <input
              type="text"
              value={settings.closing_time}
              onChange={(event) => setSettings((current) => ({ ...current, closing_time: event.target.value }))}
              className="w-28 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none"
            />
          </SettingRow>
          <p className="text-xs text-slate-400 mt-2 px-1 font-medium">Format: 10:00 AM / 11:00 PM</p>
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
