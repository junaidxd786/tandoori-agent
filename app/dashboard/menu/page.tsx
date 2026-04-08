"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus, Trash2, Loader2,
  Search, AlertCircle, CheckCircle2,
  Package, ChevronDown, UploadCloud
} from "lucide-react";
import { clsx } from "clsx";

interface MenuItem {
  id?: string;               // undefined == newly added row, not yet in DB
  name: string;
  price: number;
  category: string;
  is_available: boolean;
  _dirty?: boolean;          // locally edited but not yet saved (new rows)
  _saving?: boolean;         // per-row spinner
  _deleting?: boolean;       // per-row delete spinner
}

type ExtractedMenuItem = {
  name: string;
  price: number;
  category?: string;
};

// ─── tiny helpers ────────────────────────────────────────────────────────────

async function patchItem(id: string, patch: Partial<MenuItem>) {
  const res = await fetch(`/api/menu/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function deleteItem(id: string) {
  const res = await fetch(`/api/menu/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

// ─── component ───────────────────────────────────────────────────────────────

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" | null }>({ text: "", type: null });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (text: string, type: "success" | "error") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, type });
    toastTimer.current = setTimeout(() => setToast({ text: "", type: null }), 3500);
  };

  // ── load ──────────────────────────────────────────────────────────────────
  const loadMenu = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/menu");
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  // ── derived ───────────────────────────────────────────────────────────────
  const categories = Array.from(new Set(items.map((i) => i.category || ""))).filter(Boolean).sort();

  const filteredItems = items.filter((item) => {
    const matchSearch =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.category || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = selectedCategory === "all" || item.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const newRowCount = items.filter((i) => !i.id).length;

  // ── local state updater (keyed by id or temp key) ─────────────────────────
  const mutateById = (id: string | undefined, idx_fallback: number, patch: Partial<MenuItem>) => {
    setItems((prev) => {
      const next = [...prev];
      // prefer id lookup; fall back to position (for new rows without id)
      const realIdx = id
        ? next.findIndex((x) => x.id === id)
        : idx_fallback;
      if (realIdx === -1) return prev;
      next[realIdx] = { ...next[realIdx], ...patch };
      return next;
    });
  };

  // ── INLINE EDIT (blur auto-save for persisted rows) ───────────────────────
  const handleBlurSave = async (item: MenuItem) => {
    if (!item.id) return;              // new row → handled by Save & Sync
    if (!item.name.trim()) return;     // skip empty
    mutateById(item.id, -1, { _saving: true });
    try {
      await patchItem(item.id, {
        name: item.name,
        price: item.price,
        category: item.category,
      });
    } catch {
      showToast("Failed to save — please try again.", "error");
    } finally {
      mutateById(item.id, -1, { _saving: false });
    }
  };

  // ── AVAILABILITY TOGGLE (immediate) ───────────────────────────────────────
  const handleToggle = async (item: MenuItem, fallbackIdx: number) => {
    const newVal = !item.is_available;
    mutateById(item.id, fallbackIdx, { is_available: newVal });
    if (!item.id) return;              // new row, no DB call yet
    try {
      await patchItem(item.id, { is_available: newVal });
    } catch {
      // revert
      mutateById(item.id, fallbackIdx, { is_available: !newVal });
      showToast("Could not update availability.", "error");
    }
  };

  // ── DELETE (immediate for persisted rows) ─────────────────────────────────
  const handleDelete = async (item: MenuItem, fallbackIdx: number) => {
    if (!item.id) {
      // new unsaved row — just remove from local state
      setItems((prev) => prev.filter((_, i) => i !== fallbackIdx));
      return;
    }
    mutateById(item.id, fallbackIdx, { _deleting: true });
    try {
      await deleteItem(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      showToast("Item deleted.", "success");
    } catch {
      mutateById(item.id, fallbackIdx, { _deleting: false });
      showToast("Delete failed — please try again.", "error");
    }
  };

  // ── ADD NEW ROW ───────────────────────────────────────────────────────────
  const handleAddRow = () => {
    setItems([{ name: "", price: 0, category: "", is_available: true, _dirty: true }, ...items]);
  };

  // ── BULK SAVE & SYNC (for new rows OR after image upload) ─────────────────
  const handleSaveAll = async () => {
    setBulkSaving(true);
    try {
      const res = await fetch("/api/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.filter((i) => i.name.trim()),
          replaceAll: true,
        }),
      });
      if (res.ok) {
        showToast("Catalog synced successfully.", "success");
        loadMenu();
      } else {
        showToast("Failed to sync menu.", "error");
      }
    } catch {
      showToast("An error occurred.", "error");
    } finally {
      setBulkSaving(false);
    }
  };

  // ── IMAGE UPLOAD ──────────────────────────────────────────────────────────
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessing(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const res = await fetch("/api/menu/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: base64 }),
        });
        if (res.ok) {
          const data = await res.json();
          const normalized = ((data.items || []) as ExtractedMenuItem[]).map((item) => ({
            ...item,
            category: item.category || "",
            is_available: true,
            _dirty: true,
          }));
          setItems(replaceExisting ? normalized : [...normalized, ...items]);
          showToast(`Extracted ${normalized.length} items. Click Save & Sync to persist.`, "success");
        } else {
          showToast("Could not extract items.", "error");
        }
        setProcessing(false);
      };
      reader.readAsDataURL(file);
    } catch {
      showToast("Error processing photo.", "error");
      setProcessing(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 animate-fade-in pb-12">

      {/* Top Action Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">Menu Editor</h1>
          <p className="text-slate-500 text-sm">
            Changes to existing items save automatically. New rows require&nbsp;
            <span className="font-semibold text-slate-700">Save &amp; Sync</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-600 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              className="rounded border-slate-300 text-brand focus:ring-brand/20 w-3.5 h-3.5"
            />
            Replace on Upload
          </label>

          <label className="cursor-pointer group flex items-center justify-center h-10 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 transition-colors text-sm font-medium text-slate-700 shadow-sm">
            {processing ? <Loader2 className="animate-spin w-4 h-4 mr-2 text-brand" /> : <UploadCloud size={16} className="text-slate-500 mr-2 group-hover:text-brand transition-colors" />}
            {processing ? "Scanning..." : "Upload Photo"}
            <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" disabled={processing} />
          </label>

          <button
            onClick={handleAddRow}
            className="flex items-center justify-center h-10 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 transition-colors text-sm font-medium shadow-sm"
          >
            <Plus size={16} className="mr-1.5 text-slate-500" /> Add Row
          </button>

          <button
            onClick={handleSaveAll}
            disabled={bulkSaving || items.length === 0}
            className="flex items-center justify-center h-10 px-6 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:bg-slate-300 disabled:text-slate-500 text-white transition-colors text-sm font-semibold shadow-sm shadow-orange-200 ml-1"
          >
            {bulkSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : <CheckCircle2 size={16} className="mr-2" />}
            {bulkSaving ? "Syncing..." : `Save & Sync${newRowCount > 0 ? ` (${newRowCount} new)` : ""}`}
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="ui-card flex flex-col overflow-hidden bg-white">

        {/* Toolbar */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-4 justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="bg-brand/10 text-brand text-xs px-2.5 py-1 rounded-full font-bold">
              {items.length} items
            </span>
            {newRowCount > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs px-2.5 py-1 rounded-full font-bold">
                {newRowCount} unsaved
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64 group">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand transition-colors" />
              <input
                type="text"
                placeholder="Search catalog..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-10 bg-white border border-slate-200 rounded-xl pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-orange-300 focus:ring-2 focus:ring-brand/10 transition-all shadow-sm"
              />
            </div>

            <div className="relative w-full sm:w-48 group">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full h-10 bg-white border border-slate-200 rounded-xl pl-3 pr-8 text-sm text-slate-700 focus:outline-none focus:border-orange-300 focus:ring-2 focus:ring-brand/10 appearance-none cursor-pointer transition-all shadow-sm font-medium"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">

            {/* Header */}
            <div className="grid grid-cols-[3fr_2fr_130px_100px_80px] gap-4 px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <div>Item Name</div>
              <div>Category</div>
              <div>Price (Rs.)</div>
              <div className="text-center">Available</div>
              <div className="text-center">Delete</div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-slate-100">
              {loading && filteredItems.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 bg-slate-50/50 animate-pulse border-b border-slate-50" />
                ))
              ) : filteredItems.length === 0 ? (
                <div className="py-24 flex flex-col items-center justify-center bg-slate-50/30">
                  <Package size={32} className="text-slate-300 mb-4" />
                  <p className="text-slate-500 font-medium">No menu items found.</p>
                  <p className="text-sm text-slate-400 mt-1">Add a row or upload a menu photo to get started.</p>
                </div>
              ) : (
                filteredItems.map((item) => {
                  // find ORIGINAL index (in full `items` array) for new rows that have no id
                  const originalIdx = items.findIndex((x) =>
                    item.id ? x.id === item.id : x === item
                  );

                  return (
                    <div
                      key={item.id ?? `new-${originalIdx}`}
                      className={clsx(
                        "grid grid-cols-[3fr_2fr_130px_100px_80px] gap-4 px-6 py-2 items-center hover:bg-slate-50/80 transition-colors group",
                        !item.id && "bg-amber-50/30",
                        item._deleting && "opacity-40 pointer-events-none"
                      )}
                    >
                      {/* Name */}
                      <div className="flex items-center gap-2">
                        {item._saving && <Loader2 size={12} className="animate-spin text-brand flex-shrink-0" />}
                        <input
                          className="bg-transparent w-full text-sm font-medium text-slate-900 outline-none px-3 py-2 rounded-lg hover:bg-slate-100/50 focus:bg-white focus:ring-2 focus:ring-brand/20 focus:border-orange-200 border border-transparent transition-all placeholder-slate-400"
                          value={item.name}
                          onChange={(e) => mutateById(item.id, originalIdx, { name: e.target.value })}
                          onBlur={() => handleBlurSave(item)}
                          placeholder="e.g. Garlic Naan"
                          autoFocus={!item.id && item.name === ""}
                        />
                      </div>

                      {/* Category */}
                      <input
                        className="bg-transparent w-full text-sm text-slate-600 outline-none px-3 py-2 rounded-lg hover:bg-slate-100/50 focus:bg-white focus:ring-2 focus:ring-brand/20 focus:border-orange-200 border border-transparent transition-all placeholder-slate-400"
                        value={item.category || ""}
                        onChange={(e) => mutateById(item.id, originalIdx, { category: e.target.value })}
                        onBlur={() => handleBlurSave(item)}
                        placeholder="e.g. Breads"
                      />

                      {/* Price */}
                      <div className="flex items-center px-3 py-2 rounded-lg border border-transparent hover:bg-slate-100/50 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-orange-200 transition-all">
                        <span className="text-slate-400 text-sm font-medium mr-1.5">Rs.</span>
                        <input
                          type="number"
                          className="bg-transparent w-full text-sm font-semibold text-slate-900 outline-none placeholder-slate-300"
                          value={item.price || ""}
                          onChange={(e) => mutateById(item.id, originalIdx, { price: parseFloat(e.target.value) || 0 })}
                          onBlur={() => handleBlurSave(item)}
                          placeholder="0"
                        />
                      </div>

                      {/* Available Toggle */}
                      <div className="flex justify-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.is_available}
                          onClick={() => handleToggle(item, originalIdx)}
                          className={clsx(
                            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                            item.is_available ? "bg-emerald-500" : "bg-slate-200"
                          )}
                          title={item.is_available ? "Mark unavailable" : "Mark available"}
                        >
                          <span
                            className={clsx(
                              "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200",
                              item.is_available ? "translate-x-4" : "translate-x-1"
                            )}
                          />
                        </button>
                      </div>

                      {/* Delete */}
                      <div className="flex justify-center">
                        {item._deleting ? (
                          <Loader2 size={16} className="animate-spin text-red-400" />
                        ) : (
                          <button
                            onClick={() => handleDelete(item, originalIdx)}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete Item"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast.text && (
        <div className="fixed bottom-8 right-8 z-[100] px-5 py-3.5 rounded-xl bg-white border border-slate-200 shadow-xl flex items-center gap-3 animate-fade-in">
          {toast.type === "success" ? (
            <div className="p-1 bg-emerald-50 rounded-full">
              <CheckCircle2 size={18} className="text-emerald-500" />
            </div>
          ) : (
            <div className="p-1 bg-red-50 rounded-full">
              <AlertCircle size={18} className="text-red-500" />
            </div>
          )}
          <p className="text-sm font-semibold text-slate-800">{toast.text}</p>
        </div>
      )}

    </div>
  );
}
