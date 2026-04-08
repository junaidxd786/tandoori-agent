"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ShoppingBag, MapPin, Clock,
  ChevronDown, RefreshCw, Search,
  Phone, Users, Package, ChevronUp,
  Truck, Receipt
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { clsx } from "clsx";

interface OrderItem { id: string; name: string; qty: number; price: number; }

interface Order {
  id: string;
  order_number: number;
  type: "delivery" | "dine-in";
  status: string;
  subtotal: number;
  delivery_fee: number;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  created_at: string;
  order_items: OrderItem[];
  conversations: { phone: string; name: string | null } | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  received:        { label: "New Order",      color: "text-blue-700 bg-blue-50 border-blue-200",     dot: "bg-blue-500" },
  preparing:       { label: "Preparing",       color: "text-amber-700 bg-amber-50 border-amber-200",  dot: "bg-amber-500" },
  out_for_delivery:{ label: "Out for Delivery",color: "text-indigo-700 bg-indigo-50 border-indigo-200", dot: "bg-indigo-500" },
  delivered:       { label: "Delivered",       color: "text-emerald-700 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  cancelled:       { label: "Cancelled",       color: "text-slate-600 bg-slate-100 border-slate-200", dot: "bg-slate-400" },
};

type FilterTab = "all" | "active" | "delivered" | "cancelled";
const ACTIVE_STATUSES = ["received", "preparing", "out_for_delivery"];

export default function OrdersPage() {
  const [orders, setOrders]         = useState<Order[]>([]);
  const [loading, setLoading]       = useState(true);
  const [activeTab, setActiveTab]   = useState<FilterTab>("active");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ── data ─────────────────────────────────────────────────────────────────── */
  const loadOrders = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/orders", { headers: { "ngrok-skip-browser-warning": "69420" } });
    if (res.ok) setOrders(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadOrders();
    }, 0);

    return () => clearTimeout(timeout);
  }, [loadOrders]);

  useEffect(() => {
    const channel = supabase
      .channel("orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, loadOrders)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadOrders]);

  /* ── status update ─────────────────────────────────────────────────────────── */
  const updateStatus = async (orderId: string, status: string) => {
    setUpdatingId(orderId);
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
    }
    setUpdatingId(null);
  };

  const filteredOrders = orders.filter((o) => {
    let matchTab = true;
    if (activeTab === "active")    matchTab = ACTIVE_STATUSES.includes(o.status);
    if (activeTab === "delivered") matchTab = o.status === "delivered";
    if (activeTab === "cancelled") matchTab = o.status === "cancelled";

    const searchLower = searchTerm.toLowerCase();
    const matchSearch = searchTerm === "" ||
      o.order_number.toString().includes(searchLower) ||
      (o.conversations?.name  || "").toLowerCase().includes(searchLower) ||
      (o.conversations?.phone || "").toLowerCase().includes(searchLower) ||
      (o.address || "").toLowerCase().includes(searchLower);

    return matchTab && matchSearch;
  });

  /* ── counts ───────────────────────────────────────────────────────────────── */
  const counts = {
    all:       orders.length,
    active:    orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length,
    delivered: orders.filter(o => o.status === "delivered").length,
    cancelled: orders.filter(o => o.status === "cancelled").length,
  };

  return (
    <div className="h-full flex flex-col gap-6 animate-fade-in pb-12">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 py-2 mb-2">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">Order Queue</h1>
          <p className="text-sm text-slate-500 font-medium">Live kitchen dashboard and delivery management.</p>
        </div>
        <button
          onClick={loadOrders}
          disabled={loading}
          className="flex items-center justify-center h-10 px-6 bg-brand hover:bg-brand-hover text-white shadow-sm shadow-orange-200 transition-all rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-50 disabled:bg-slate-300 disabled:text-slate-500"
        >
          <RefreshCw size={14} className={clsx("mr-2", loading && "animate-spin")} />
          Sync Data
        </button>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4 items-center justify-between bg-white border border-slate-200 p-2.5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-1 p-1 bg-slate-50 rounded-xl overflow-x-auto w-full lg:w-auto border border-slate-200/80">
          {(["all", "active", "delivered", "cancelled"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                "rounded-lg px-5 h-8 text-xs font-semibold capitalize transition-all flex-shrink-0 border flex items-center gap-2",
                activeTab === tab
                  ? "bg-white text-brand shadow-sm border-slate-200/80"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 border-transparent"
              )}
            >
              {tab}
              <span className={clsx(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                activeTab === tab ? "bg-orange-100 text-brand" : "bg-slate-200 text-slate-500"
              )}>
                {counts[tab]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-96 group">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand transition-colors" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by order #, name, phone or address..."
            className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-orange-300 focus:ring-2 focus:ring-brand/10 transition-all shadow-sm"
          />
        </div>
      </div>

      {/* ── Order list ──────────────────────────────────────────────────────── */}
      <div className="flex-1 space-y-3 pb-10">
        {loading && filteredOrders.length === 0 && searchTerm === "" ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-28 bg-white border border-slate-100 shadow-sm rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 rounded-3xl border-2 border-dashed border-slate-200 bg-white/50">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <ShoppingBag size={28} className="text-slate-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              {searchTerm ? "No Matching Results" : "No Orders Found"}
            </h3>
            <p className="text-sm font-medium text-slate-500 mt-1">
              {searchTerm ? `No orders found for "${searchTerm}".` : "There are no orders matching this filter."}
            </p>
          </div>
        ) : (
          filteredOrders.map((order) => {
            const s = STATUS_MAP[order.status] ?? STATUS_MAP.received;
            const isExpanded = expandedId === order.id;
            const customerName  = order.conversations?.name  ?? "Guest Customer";
            const customerPhone = order.conversations?.phone  ?? null;
            const deliveryFee = order.delivery_fee ?? 0;
            const hasDeliveryFee = order.type === "delivery" && deliveryFee > 0;
            const effectiveTotal = order.subtotal + deliveryFee;
            const totalItems = order.order_items.reduce((sum, i) => sum + i.qty, 0);

            return (
              <div
                key={order.id}
                className={clsx(
                  "bg-white border rounded-2xl shadow-sm transition-all duration-200",
                  isExpanded ? "border-brand/30 shadow-md" : "border-slate-200 hover:border-slate-300 hover:shadow-md"
                )}
              >
                {/* ── Summary Row ─────────────────────────────────────────── */}
                <div
                  className="flex flex-col sm:flex-row items-stretch sm:items-center p-4 lg:p-5 gap-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                >
                  {/* Left: order number + status badge */}
                  <div className="flex items-center gap-3 sm:w-44 flex-shrink-0">
                    <div className="flex flex-col items-start gap-1.5">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Order</span>
                      <span className="text-xl font-bold text-slate-900 tabular-nums leading-none">
                        #{order.order_number}
                      </span>
                    </div>
                    <div className={clsx(
                      "ml-auto sm:ml-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border",
                      s.color
                    )}>
                      <span className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", s.dot)} />
                      {s.label}
                    </div>
                  </div>

                  {/* Center: customer + delivery info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                      <h3 className="text-base font-bold text-slate-900">
                        {customerName}
                      </h3>
                      {customerPhone && (
                        <a
                          href={`tel:${customerPhone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md hover:bg-orange-100 transition-colors"
                        >
                          <Phone size={11} />
                          {customerPhone}
                        </a>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <Clock size={13} className="text-slate-400" />
                        {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                      </div>
                      <span className="w-1 h-1 rounded-full bg-slate-300" />
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 capitalize">
                        {order.type === "delivery" ? (
                          <Truck size={13} className="text-slate-400" />
                        ) : (
                          <Users size={13} className="text-slate-400" />
                        )}
                        {order.type.replace("-", " ")}
                        {order.guests ? ` · ${order.guests} guests` : ""}
                      </div>
                      {order.address && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-slate-300" />
                          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 max-w-xs truncate">
                            <MapPin size={13} className="text-slate-400 flex-shrink-0" />
                            <span className="truncate">{order.address}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: totals + status dropdown + chevron */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 sm:w-64 flex-shrink-0 border-t border-slate-100 sm:border-0 pt-3 sm:pt-0">
                    <div className="text-left sm:text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                        {totalItems} item{totalItems !== 1 ? "s" : ""} · {hasDeliveryFee ? "With Delivery" : "Subtotal"}
                      </p>
                      <p className="text-lg font-bold text-slate-900 tracking-tight">
                        ₨ {Number(effectiveTotal).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <select
                          value={order.status}
                          disabled={updatingId === order.id}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { e.stopPropagation(); updateStatus(order.id, e.target.value); }}
                          className="pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100 rounded-xl text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 appearance-none cursor-pointer outline-none focus:ring-2 focus:ring-brand/20 transition-all border border-slate-200 disabled:opacity-50 shadow-sm"
                        >
                          {["received", "preparing", "out_for_delivery", "delivered", "cancelled"].map((v) => (
                            <option key={v} value={v} className="bg-white text-slate-700 capitalize font-medium">
                              {v.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
                      </div>

                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : order.id); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-all flex-shrink-0"
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Expanded Detail Panel ───────────────────────────────── */}
                {isExpanded && (
                  <div className="border-t border-slate-100 mx-4 lg:mx-5 pb-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-5">

                      {/* Order Items */}
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-6 h-6 bg-orange-100 rounded-md flex items-center justify-center">
                            <Package size={13} className="text-brand" />
                          </div>
                          <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Order Items</span>
                        </div>
                        <div className="space-y-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
                          {order.order_items.length === 0 ? (
                            <p className="text-xs text-slate-400 italic py-1">No items recorded.</p>
                          ) : (
                            order.order_items.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-orange-100 text-brand text-[10px] font-black flex items-center justify-center">
                                    {item.qty}
                                  </span>
                                  <span className="text-sm font-semibold text-slate-800 truncate">{item.name}</span>
                                </div>
                                <span className="text-sm font-bold text-slate-700 flex-shrink-0">
                                  ₨ {Number(item.price * item.qty).toLocaleString()}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Right column: Customer + Price Breakdown */}
                      <div className="space-y-4">

                        {/* Customer Info */}
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-6 h-6 bg-blue-100 rounded-md flex items-center justify-center">
                              <Phone size={13} className="text-blue-600" />
                            </div>
                            <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Customer Details</span>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-slate-500 font-medium">Name</span>
                              <span className="text-sm font-bold text-slate-800">{customerName}</span>
                            </div>
                            {customerPhone && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-slate-500 font-medium">Phone</span>
                                <a
                                  href={`tel:${customerPhone}`}
                                  className="text-sm font-bold text-brand hover:underline"
                                >
                                  {customerPhone}
                                </a>
                              </div>
                            )}
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-slate-500 font-medium">Order Type</span>
                              <span className="text-sm font-bold text-slate-800 capitalize">
                                {order.type.replace("-", " ")}
                              </span>
                            </div>
                            {order.address && (
                              <div className="flex justify-between items-start gap-4">
                                <span className="text-xs text-slate-500 font-medium flex-shrink-0">Deliver To</span>
                                <span className="text-sm font-bold text-slate-800 text-right">{order.address}</span>
                              </div>
                            )}
                            {order.guests != null && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-slate-500 font-medium">Guests</span>
                                <span className="text-sm font-bold text-slate-800">{order.guests} people</span>
                              </div>
                            )}
                            {order.reservation_time && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-slate-500 font-medium">Reservation</span>
                                <span className="text-sm font-bold text-slate-800">
                                  {format(new Date(order.reservation_time), "dd MMM, hh:mm a")}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-slate-500 font-medium">Placed At</span>
                              <span className="text-sm font-bold text-slate-800">
                                {format(new Date(order.created_at), "dd MMM yyyy, hh:mm a")}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Price Breakdown */}
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-6 h-6 bg-emerald-100 rounded-md flex items-center justify-center">
                              <Receipt size={13} className="text-emerald-600" />
                            </div>
                            <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Price Breakdown</span>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-slate-500 font-medium">Subtotal</span>
                              <span className="text-sm font-semibold text-slate-700">
                                ₨ {Number(order.subtotal).toLocaleString()}
                              </span>
                            </div>
                            {order.type === "delivery" && (
                              hasDeliveryFee ? (
                                <>
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                                      <Truck size={11} /> Delivery Fee
                                    </span>
                                    <span className="text-sm font-semibold text-slate-700">
                                      ₨ {Number(deliveryFee).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="border-t border-slate-200 pt-2 flex justify-between items-center">
                                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Total</span>
                                    <span className="text-base font-black text-slate-900">
                                      ₨ {Number(effectiveTotal).toLocaleString()}
                                    </span>
                                  </div>
                                </>
                              ) : (
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                                    <Truck size={11} /> Delivery
                                  </span>
                                  <span className="text-sm font-bold text-emerald-600">Free 🎉</span>
                                </div>
                              )
                            )}
                          </div>

                        </div>

                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
