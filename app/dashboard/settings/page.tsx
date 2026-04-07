"use client";

import { useEffect, useState } from "react";
import { Save, RefreshCw, Store, Clock, Truck } from "lucide-react";
import { toast } from "sonner";
import { clsx } from "clsx";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [settings, setSettings] = useState({
    is_accepting_orders: true,
    opening_time:  "10:00 AM",
    closing_time:  "11:00 PM",
    delivery_enabled: false,
    delivery_fee: 0,
  });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { setSettings((p) => ({ ...p, ...d })); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error();
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const Toggle = ({
    value,
    onToggle,
    color = "bg-brand",
  }: {
    value: boolean;
    onToggle: () => void;
    color?: string;
  }) => (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200",
        value ? color : "bg-slate-200"
      )}
    >
      <span className={clsx(
        "inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200",
        value ? "translate-x-5" : "translate-x-0"
      )} />
    </button>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <RefreshCw className="animate-spin w-5 h-5 text-slate-400" />
    </div>
  );

  return (
    <div className="w-full flex flex-col gap-6 pb-8">

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-brand text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition hover:bg-brand-hover disabled:opacity-50 shadow-sm shadow-orange-200"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {/* ── Grid of setting cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Card 1 — Store Status */}
        <Card icon={<Store size={16} />} title="Store Status">
          <SettingRow label="Accepting Orders">
            <Toggle
              value={settings.is_accepting_orders}
              onToggle={() => setSettings((s) => ({ ...s, is_accepting_orders: !s.is_accepting_orders }))}
              color="bg-emerald-500"
            />
          </SettingRow>
          <StatusBadge
            active={!settings.is_accepting_orders}
            color="orange"
            text="Closed — AI will not place orders"
          />
          <StatusBadge
            active={settings.is_accepting_orders}
            color="emerald"
            text="Open — accepting orders"
          />
        </Card>

        {/* Card 2 — Business Hours */}
        <Card icon={<Clock size={16} />} title="Business Hours">
          <SettingRow label="Opens">
            <input
              type="text"
              value={settings.opening_time}
              onChange={(e) => setSettings((s) => ({ ...s, opening_time: e.target.value }))}
              placeholder="10:00 AM"
              className="w-28 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none placeholder:text-slate-400 focus:text-brand"
            />
          </SettingRow>
          <SettingRow label="Closes">
            <input
              type="text"
              value={settings.closing_time}
              onChange={(e) => setSettings((s) => ({ ...s, closing_time: e.target.value }))}
              placeholder="11:00 PM"
              className="w-28 text-right text-sm font-semibold text-slate-800 bg-transparent outline-none placeholder:text-slate-400 focus:text-brand"
            />
          </SettingRow>
          <p className="text-xs text-slate-400 mt-2 px-1 font-medium">
            Format: 10:00 AM / 11:00 PM
          </p>
        </Card>

        {/* Card 3 — Delivery */}
        <Card icon={<Truck size={16} />} title="Delivery">
          <SettingRow label="Charge Delivery Fee">
            <Toggle
              value={settings.delivery_enabled}
              onToggle={() => setSettings((s) => ({ ...s, delivery_enabled: !s.delivery_enabled }))}
            />
          </SettingRow>

          {settings.delivery_enabled ? (
            <SettingRow label="Fee Amount">
              <div className="flex items-center gap-1">
                <span className="text-sm text-slate-400">₨</span>
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={settings.delivery_fee}
                  onChange={(e) => setSettings((s) => ({ ...s, delivery_fee: Number(e.target.value) }))}
                  className="w-24 text-right text-sm font-bold text-slate-800 bg-transparent outline-none focus:text-brand"
                />
              </div>
            </SettingRow>
          ) : null}

          <StatusBadge
            active={!settings.delivery_enabled}
            color="emerald"
            text="Free delivery is active"
          />
          <StatusBadge
            active={settings.delivery_enabled && settings.delivery_fee === 0}
            color="slate"
            text="Fee is ₨ 0 — effectively free"
          />
          <StatusBadge
            active={settings.delivery_enabled && settings.delivery_fee > 0}
            color="orange"
            text={`₨ ${Number(settings.delivery_fee).toLocaleString()} charged per order`}
          />
        </Card>

      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

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
      <div className="flex flex-col gap-0 flex-1 px-5 py-3 divide-y divide-slate-50">
        {children}
      </div>
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
    orange:  "bg-orange-50 text-orange-700 border-orange-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    slate:   "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <p className={clsx("text-xs font-medium px-3 py-1.5 rounded-lg border mt-2", colors[color])}>
      {text}
    </p>
  );
}