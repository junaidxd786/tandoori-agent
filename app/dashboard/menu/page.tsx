"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, Search, Trash2, UploadCloud } from "lucide-react";
import { clsx } from "clsx";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";

interface MenuItem {
  id?: string;
  name: string;
  price: number;
  category: string;
  description?: string | null;
  is_available: boolean;
  _saving?: boolean;
  _deleting?: boolean;
}

type ExtractedMenuItem = { name: string; price: number; category?: string };
type ImportWarning = { code: "duplicate" | "invalid_name" | "invalid_price"; message: string };

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizeCategory = (value?: string | null) =>
  normalizeWhitespace(value ?? "")
    .split(" ")
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === "bbq" ? "BBQ" : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");

function normalizeItems(items: MenuItem[]) {
  const warnings: ImportWarning[] = [];
  const seen = new Set<string>();
  const normalized: MenuItem[] = [];

  items.forEach((item) => {
    const name = normalizeWhitespace(item.name);
    const price = Number(item.price);
    const key = name.toLowerCase();
    const description = item.description ? normalizeWhitespace(item.description) : null;

    if (!name) {
      warnings.push({ code: "invalid_name", message: "One extracted item was skipped because its name was empty." });
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      warnings.push({ code: "invalid_price", message: `${name} was skipped because its price was invalid.` });
      return;
    }

    if (seen.has(key)) {
      warnings.push({ code: "duplicate", message: `${name} appeared more than once in the import preview.` });
      return;
    }

    seen.add(key);
    normalized.push({
      id: item.id,
      name,
      price,
      category: normalizeCategory(item.category),
      description,
      is_available: item.is_available ?? true,
    });
  });

  return { items: normalized, warnings };
}

function mergeImportedItems(currentItems: MenuItem[], importedItems: MenuItem[]) {
  const currentMap = new Map(currentItems.map((item) => [item.name.toLowerCase(), item]));
  const next = [...currentItems];

  importedItems.forEach((item) => {
    const existing = currentMap.get(item.name.toLowerCase());
    if (existing) {
      Object.assign(existing, {
        name: item.name,
        price: item.price,
        category: item.category,
        description: item.description ?? null,
        is_available: item.is_available,
      });
    } else {
      next.unshift({ ...item });
    }
  });

  return next.map((item) => ({ ...item }));
}

async function patchItem(id: string, patch: Partial<MenuItem>) {
  const response = await fetch(`/api/menu/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(await response.text());
}

async function deleteItem(id: string) {
  const response = await fetch(`/api/menu/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await response.text());
}

export default function MenuPage() {
  const { selectedBranchId, selectedBranch } = useDashboardContext();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [importPreview, setImportPreview] = useState<MenuItem[]>([]);
  const [importWarnings, setImportWarnings] = useState<ImportWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [jsonUploading, setJsonUploading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" | null }>({ text: "", type: null });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, type: "success" | "error") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, type });
    toastTimer.current = setTimeout(() => setToast({ text: "", type: null }), 3500);
  }, []);

  const loadMenu = useCallback(async () => {
    if (selectedBranchId === "all") {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/menu?branch_id=${encodeURIComponent(selectedBranchId)}`);
      if (!response.ok) throw new Error("Failed to load menu");
      setItems(await response.json());
    } catch {
      showToast("Failed to load menu.", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, showToast]);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  const categories = useMemo(
    () => Array.from(new Set(items.map((item) => item.category || ""))).filter(Boolean).sort(),
    [items],
  );

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesSearch =
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (item.category || "").toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
        return matchesSearch && matchesCategory;
      }),
    [items, searchTerm, selectedCategory],
  );

  const importStats = useMemo(() => {
    const currentNames = new Set(items.map((item) => item.name.toLowerCase()));
    let createCount = 0;
    let updateCount = 0;

    importPreview.forEach((item) => {
      if (currentNames.has(item.name.toLowerCase())) updateCount += 1;
      else createCount += 1;
    });

    return { createCount, updateCount };
  }, [items, importPreview]);

  const mutateItem = (index: number, patch: Partial<MenuItem>) => {
    setItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const handleBlurSave = async (item: MenuItem, index: number) => {
    if (!item.id || !item.name.trim()) return;
    mutateItem(index, { _saving: true });
    try {
      await patchItem(item.id, {
        name: item.name,
        price: item.price,
        category: item.category,
        is_available: item.is_available,
      });
    } catch {
      showToast("Failed to save row.", "error");
    } finally {
      mutateItem(index, { _saving: false });
    }
  };

  const handleToggle = async (item: MenuItem, index: number) => {
    const nextValue = !item.is_available;
    mutateItem(index, { is_available: nextValue });
    if (!item.id) return;

    try {
      await patchItem(item.id, { is_available: nextValue });
    } catch {
      mutateItem(index, { is_available: !nextValue });
      showToast("Could not update availability.", "error");
    }
  };

  const handleDelete = async (item: MenuItem, index: number) => {
    if (!item.id) {
      setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
      return;
    }

    mutateItem(index, { _deleting: true });
    try {
      await deleteItem(item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      showToast("Item deleted.", "success");
    } catch {
      mutateItem(index, { _deleting: false });
      showToast("Delete failed.", "error");
    }
  };

  const handleSaveAll = async () => {
    if (selectedBranchId === "all") return;

    setBulkSaving(true);
    try {
      const response = await fetch(`/api/menu?branch_id=${encodeURIComponent(selectedBranchId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.filter((item) => item.name.trim()),
          replaceAll: replaceExisting,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        const issues = body.issues?.map((issue: { message: string }) => issue.message).join(" ");
        throw new Error(issues || body.error || "Failed to save menu");
      }

      showToast(replaceExisting ? "Catalog replaced successfully." : "Catalog changes applied safely.", "success");
      setImportPreview([]);
      setImportWarnings([]);
      await loadMenu();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save menu.", "error");
    } finally {
      setBulkSaving(false);
    }
  };

  const applyImportPreview = () => {
    setItems((prev) => (replaceExisting ? importPreview.map((item) => ({ ...item })) : mergeImportedItems(prev, importPreview)));
    showToast(replaceExisting ? "Import replaced the local draft." : "Import merged into the local draft.", "success");
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProcessing(true);

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          if (selectedBranchId === "all") {
            throw new Error("Please choose a single branch before uploading a menu.");
          }

          const response = await fetch(`/api/menu/process?branch_id=${encodeURIComponent(selectedBranchId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: reader.result as string }),
          });

          if (!response.ok) throw new Error("Could not extract items.");
          const payload = (await response.json()) as { items?: ExtractedMenuItem[] };
          const normalized = normalizeItems(
            (payload.items ?? []).map((item) => ({
              name: item.name,
              price: item.price,
              category: item.category || "",
              is_available: true,
            })),
          );

          setImportPreview(normalized.items);
          setImportWarnings(normalized.warnings);
          showToast(`Prepared ${normalized.items.length} imported items for review.`, "success");
        } catch (error) {
          showToast(error instanceof Error ? error.message : "Import failed.", "error");
        } finally {
          setProcessing(false);
          event.target.value = "";
        }
      };

      reader.readAsDataURL(file);
    } catch {
      setProcessing(false);
      showToast("Error reading photo.", "error");
    }
  };

  const handleJsonUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setJsonUploading(true);
    try {
      if (selectedBranchId === "all") {
        throw new Error("Please choose a single branch before uploading a menu.");
      }

      const rawText = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        throw new Error("That file is not valid JSON.");
      }

      const rawItems: unknown =
        Array.isArray(parsed)
          ? parsed
          : typeof parsed === "object" && parsed !== null
            ? // Support common wrappers: { items: [...] } or { menu: [...] }
              (parsed as Record<string, unknown>).items ?? (parsed as Record<string, unknown>).menu
            : null;

      if (!Array.isArray(rawItems)) {
        throw new Error("Expected a JSON array of menu items (or { items: [...] }).");
      }

      const normalized = normalizeItems(
        rawItems.map((item) => {
          if (typeof item !== "object" || item === null) {
            return { name: "", price: NaN, category: "", description: null, is_available: true };
          }
          const obj = item as Record<string, unknown>;
          return {
            name: typeof obj.name === "string" ? obj.name : "",
            price: typeof obj.price === "number" ? obj.price : Number(obj.price),
            category: typeof obj.category === "string" ? obj.category : "",
            description:
              obj.description === null ? null : typeof obj.description === "string" ? obj.description : null,
            is_available: typeof obj.is_available === "boolean" ? obj.is_available : true,
          };
        }),
      );

      if (normalized.items.length === 0) {
        throw new Error("No valid items found in the JSON file.");
      }

      const response = await fetch(`/api/menu?branch_id=${encodeURIComponent(selectedBranchId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: normalized.items.map((item) => ({
            name: item.name,
            price: item.price,
            category: item.category,
            description: item.description ?? null,
            is_available: item.is_available,
          })),
          replaceAll: replaceExisting,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        const issues = body.issues?.map((issue: { message: string }) => issue.message).join(" ");
        throw new Error(issues || body.error || "Failed to save menu");
      }

      setImportPreview([]);
      setImportWarnings([]);
      showToast(
        replaceExisting
          ? `JSON uploaded. Replaced catalog with ${normalized.items.length} items.`
          : `JSON uploaded. Applied ${normalized.items.length} items.`,
        "success",
      );
      await loadMenu();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "JSON upload failed.", "error");
    } finally {
      setJsonUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-6 pb-10">
      {selectedBranchId === "all" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Select a single branch from the sidebar to edit its menu.
        </div>
      ) : null}

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Menu Editor</h1>
          <p className="text-sm text-slate-500">
            {selectedBranch
              ? `Editing menu for ${selectedBranch.name}. Uploads create a reviewable preview first.`
              : "Uploads create a reviewable preview first, and save mode controls whether we merge changes or replace the full catalog."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">
            <input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand/20" />
            Replace catalog on save
          </label>

          <label className="flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
            {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand" /> : <UploadCloud size={16} className="mr-2 text-slate-500" />}
            {processing ? "Scanning..." : "Upload Photo"}
            <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" disabled={processing} />
          </label>

          <label className="flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
            {jsonUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand" />
            ) : (
              <UploadCloud size={16} className="mr-2 text-slate-500" />
            )}
            {jsonUploading ? "Saving JSON..." : "Upload JSON"}
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleJsonUpload}
              className="hidden"
              disabled={jsonUploading || processing}
            />
          </label>

          <button onClick={() => setItems((prev) => [{ name: "", price: 0, category: "", is_available: true }, ...prev])} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
            <Plus size={16} className="mr-1.5 inline" />
            Add Row
          </button>

          <button onClick={() => void handleSaveAll()} disabled={selectedBranchId === "all" || bulkSaving || items.length === 0} className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-orange-200 transition-colors hover:bg-brand-hover disabled:opacity-50">
            {bulkSaving ? <Loader2 size={16} className="mr-2 inline animate-spin" /> : <CheckCircle2 size={16} className="mr-2 inline" />}
            {replaceExisting ? "Save Replacement" : "Apply Changes"}
          </button>
        </div>
      </div>

      {importPreview.length > 0 && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Import Preview</h2>
              <p className="mt-1 text-sm text-slate-600">
                {replaceExisting ? "This import will replace the saved catalog when you save." : "This import will merge into matching items by name and add anything new."}
              </p>
            </div>
            <button onClick={applyImportPreview} className="rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm font-semibold text-brand shadow-sm">
              Apply Preview To Draft
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">{importPreview.length} valid items</span>
            <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">{importStats.createCount} new</span>
            <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">{importStats.updateCount} updates</span>
            {importWarnings.length > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-semibold text-red-700">{importWarnings.length} warnings</span>}
          </div>

          {importWarnings.length > 0 && (
            <div className="mt-4 space-y-2">
              {importWarnings.map((warning, index) => (
                <div key={`${warning.code}-${index}`} className="flex items-start gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-700">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>{warning.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2 text-xs font-semibold text-slate-600">
            <span className="rounded-full bg-white px-3 py-1">{items.length} items</span>
            <span className="rounded-full bg-white px-3 py-1">{replaceExisting ? "Replace mode" : "Merge mode"}</span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search catalog..."
                className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-200 focus:ring-2 focus:ring-brand/10 sm:w-64"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-200 focus:ring-2 focus:ring-brand/10"
            >
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            <div className="grid grid-cols-[3fr_2fr_130px_100px_80px] gap-4 border-b border-slate-200 bg-slate-50 px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
              <div>Item Name</div>
              <div>Category</div>
              <div>Price (Rs.)</div>
              <div className="text-center">Available</div>
              <div className="text-center">Delete</div>
            </div>

            <div className="divide-y divide-slate-100">
              {loading && filteredItems.length === 0 ? (
                Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-14 animate-pulse bg-slate-50" />)
              ) : filteredItems.length === 0 ? (
                <div className="py-20 text-center text-slate-500">
                  <p className="text-sm font-medium">No menu items match the current filters.</p>
                </div>
              ) : (
                filteredItems.map((item) => {
                  const index = items.findIndex((entry) => (item.id ? entry.id === item.id : entry === item));
                  return (
                    <div key={item.id ?? `draft-${index}`} className={clsx("grid grid-cols-[3fr_2fr_130px_100px_80px] gap-4 px-6 py-2 items-center hover:bg-slate-50/70", item._deleting && "pointer-events-none opacity-40")}>
                      <div className="flex items-center gap-2">
                        {item._saving && <Loader2 size={12} className="animate-spin text-brand" />}
                        <input
                          value={item.name}
                          onChange={(event) => mutateItem(index, { name: event.target.value })}
                          onBlur={() => void handleBlurSave(item, index)}
                          placeholder="e.g. Garlic Naan"
                          className="w-full rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm font-medium outline-none transition-all hover:bg-slate-100/60 focus:border-orange-200 focus:bg-white focus:ring-2 focus:ring-brand/10"
                        />
                      </div>

                      <input
                        value={item.category}
                        onChange={(event) => mutateItem(index, { category: event.target.value })}
                        onBlur={() => void handleBlurSave(item, index)}
                        placeholder="e.g. Breads"
                        className="w-full rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm outline-none transition-all hover:bg-slate-100/60 focus:border-orange-200 focus:bg-white focus:ring-2 focus:ring-brand/10"
                      />

                      <div className="flex items-center rounded-lg border border-transparent px-3 py-2 transition-all hover:bg-slate-100/60 focus-within:border-orange-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/10">
                        <span className="mr-1.5 text-sm text-slate-400">Rs.</span>
                        <input
                          type="number"
                          value={item.price || ""}
                          onChange={(event) => mutateItem(index, { price: Number(event.target.value) || 0 })}
                          onBlur={() => void handleBlurSave(item, index)}
                          className="w-full bg-transparent text-sm font-semibold outline-none"
                        />
                      </div>

                      <div className="flex justify-center">
                        <button onClick={() => void handleToggle(item, index)} className={clsx("relative inline-flex h-5 w-9 items-center rounded-full transition-colors", item.is_available ? "bg-emerald-500" : "bg-slate-200")}>
                          <span className={clsx("inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform", item.is_available ? "translate-x-4" : "translate-x-1")} />
                        </button>
                      </div>

                      <div className="flex justify-center">
                        {item._deleting ? (
                          <Loader2 size={16} className="animate-spin text-red-400" />
                        ) : (
                          <button onClick={() => void handleDelete(item, index)} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500">
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

      {toast.text && (
        <div className="fixed bottom-8 right-8 z-[100] flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-xl">
          {toast.type === "success" ? (
            <CheckCircle2 size={18} className="text-emerald-500" />
          ) : (
            <AlertCircle size={18} className="text-red-500" />
          )}
          <p className="text-sm font-semibold text-slate-800">{toast.text}</p>
        </div>
      )}
    </div>
  );
}
