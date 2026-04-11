"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock, MapPin, Package, Phone, RefreshCw, Search, ShoppingBag, Truck, UserRound } from "lucide-react";
import { clsx } from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";
import { toast } from "sonner";

type OrderStatus = "received" | "preparing" | "out_for_delivery" | "delivered" | "cancelled";
type FilterTab = "all" | "active" | "delivered" | "cancelled";

interface OrderItem {
  id: string;
  name: string;
  qty: number;
  price: number;
}

interface Order {
  id: string;
  branch_id: string;
  order_number: number;
  type: "delivery" | "dine-in";
  status: OrderStatus;
  subtotal: number;
  delivery_fee: number;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  assigned_to: string | null;
  status_notified_at: string | null;
  status_notification_status: "sent" | "failed" | "skipped" | null;
  status_notification_error: string | null;
  created_at: string;
  order_items: OrderItem[];
  branches: { name: string; slug: string } | null;
  conversations: { phone: string; name: string | null } | null;
}

const ACTIVE_STATUSES: OrderStatus[] = ["received", "preparing", "out_for_delivery"];
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  received: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

const STATUS_MAP: Record<OrderStatus, { label: string; color: string }> = {
  received: { label: "New Order", color: "bg-blue-50 text-blue-700 border-blue-200" },
  preparing: { label: "Preparing", color: "bg-amber-50 text-amber-700 border-amber-200" },
  out_for_delivery: { label: "Out for Delivery", color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  delivered: { label: "Delivered", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelled", color: "bg-slate-100 text-slate-600 border-slate-200" },
};

function getStatusOptions(current: OrderStatus) {
  return [current, ...STATUS_TRANSITIONS[current]];
}

export default function OrdersPage() {
  const { selectedBranchId, selectedBranch } = useDashboardContext();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<Record<string, string>>({});

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const branchQuery = selectedBranchId === "all" ? "" : `&branch_id=${encodeURIComponent(selectedBranchId)}`;
      const response = await fetch(`/api/orders?limit=100${branchQuery}`, { headers: { "ngrok-skip-browser-warning": "69420" } });
      if (!response.ok) throw new Error("Failed to load orders");
      const data = (await response.json()) as Order[];
      setOrders(data);
      setAssignees(Object.fromEntries(data.map((order) => [order.id, order.assigned_to ?? ""])));
    } catch (error) {
      console.error(error);
      toast.error("Failed to load orders.");
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadOrders();
    }, 12000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadOrders]);

  const updateOrder = async (orderId: string, payload: { status?: OrderStatus; assigned_to?: string | null }) => {
    setSavingId(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Order update failed");
      toast.success("Order updated.");
      await loadOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Order update failed.");
    } finally {
      setSavingId(null);
    }
  };

  const handleStatusChange = async (order: Order, nextStatus: OrderStatus) => {
    if (nextStatus === order.status) return;
    if (!STATUS_TRANSITIONS[order.status].includes(nextStatus)) {
      toast.error(`Cannot move ${order.status.replaceAll("_", " ")} to ${nextStatus.replaceAll("_", " ")}.`);
      return;
    }

    if ((nextStatus === "cancelled" || nextStatus === "delivered") && !window.confirm(`Confirm marking order #${order.order_number} as ${nextStatus.replaceAll("_", " ")}?`)) {
      return;
    }

    await updateOrder(order.id, { status: nextStatus });
  };

  const handleAssign = async (order: Order) => {
    await updateOrder(order.id, { assigned_to: assignees[order.id]?.trim() || null });
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "active" && ACTIVE_STATUSES.includes(order.status)) ||
        (activeTab === "delivered" && order.status === "delivered") ||
        (activeTab === "cancelled" && order.status === "cancelled");

      const query = searchTerm.toLowerCase();
      const matchesSearch =
        !query ||
        order.order_number.toString().includes(query) ||
        (order.conversations?.name ?? "").toLowerCase().includes(query) ||
        (order.conversations?.phone ?? "").toLowerCase().includes(query) ||
        (order.address ?? "").toLowerCase().includes(query) ||
        (order.assigned_to ?? "").toLowerCase().includes(query);

      return matchesTab && matchesSearch;
    });
  }, [orders, activeTab, searchTerm]);

  const counts = {
    all: orders.length,
    active: orders.filter((order) => ACTIVE_STATUSES.includes(order.status)).length,
    delivered: orders.filter((order) => order.status === "delivered").length,
    cancelled: orders.filter((order) => order.status === "cancelled").length,
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Order Queue</h1>
          <p className="text-sm text-slate-500">
            {selectedBranch
              ? `Showing orders for ${selectedBranch.name}.`
              : "Showing combined orders across all branches."}
          </p>
        </div>
        <button onClick={() => void loadOrders()} disabled={loading} className="flex h-10 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm shadow-orange-200 transition-colors hover:bg-brand-hover disabled:opacity-50">
          <RefreshCw size={14} className={clsx("mr-2", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1">
          {(["all", "active", "delivered", "cancelled"] as FilterTab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={clsx("rounded-lg px-4 py-2 text-xs font-semibold capitalize transition-colors", activeTab === tab ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-slate-700")}>
              {tab} <span className="ml-1 text-[10px] text-slate-400">{counts[tab]}</span>
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-96">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by order, customer, phone, address, assignee..."
            className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none transition-all focus:border-orange-200 focus:ring-2 focus:ring-brand/10"
          />
        </div>
      </div>

      <div className="space-y-3">
        {loading && filteredOrders.length === 0 ? (
          Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)
        ) : filteredOrders.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white py-20 text-center text-slate-500">
            <ShoppingBag size={28} className="mx-auto mb-3 text-slate-400" />
            <p className="text-sm font-medium">No orders match this view.</p>
          </div>
        ) : (
          filteredOrders.map((order) => {
            const expanded = expandedId === order.id;
            const statusMeta = STATUS_MAP[order.status];
            const total = Number(order.subtotal) + Number(order.delivery_fee);
            const totalItems = order.order_items.reduce((sum, item) => sum + item.qty, 0);

            return (
              <div key={order.id} className={clsx("rounded-2xl border bg-white shadow-sm transition-all", expanded ? "border-brand/30 shadow-md" : "border-slate-200 hover:border-slate-300")}>
                <div className="cursor-pointer p-4 lg:p-5" onClick={() => setExpandedId(expanded ? null : order.id)}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="flex items-center gap-4 lg:w-52">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Order</p>
                        <p className="text-2xl font-bold text-slate-900">#{order.order_number}</p>
                      </div>
                      <span className={clsx("rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest", statusMeta.color)}>
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-base font-bold text-slate-900">{order.conversations?.name ?? "Guest Customer"}</p>
                        {order.conversations?.phone && (
                          <a href={`tel:${order.conversations.phone}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-brand">
                            <Phone size={11} />
                            {order.conversations.phone}
                          </a>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1.5"><Clock size={13} /> {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}</span>
                        <span className="inline-flex items-center gap-1.5 capitalize">{order.type === "delivery" ? <Truck size={13} /> : <Package size={13} />}{order.type.replace("-", " ")}</span>
                        {order.branches?.name && <span className="inline-flex items-center gap-1.5">{order.branches.name}</span>}
                        {order.address && <span className="inline-flex max-w-xs items-center gap-1.5 truncate"><MapPin size={13} /> <span className="truncate">{order.address}</span></span>}
                        <span className="inline-flex items-center gap-1.5"><UserRound size={13} /> {order.assigned_to ?? "Unassigned"}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3 lg:border-0 lg:pt-0">
                      <div className="text-left lg:text-right">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{totalItems} items</p>
                        <p className="text-lg font-bold text-slate-900">Rs. {total.toLocaleString()}</p>
                        <p className="text-[11px] text-slate-500">SLA age: {formatDistanceToNow(new Date(order.created_at))}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <select
                            value={order.status}
                            disabled={savingId === order.id}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => void handleStatusChange(order, event.target.value as OrderStatus)}
                            className="appearance-none rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 outline-none transition-all focus:ring-2 focus:ring-brand/10"
                          >
                            {getStatusOptions(order.status).map((status) => (
                              <option key={status} value={status}>
                                {status.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>

                        <button onClick={(event) => { event.stopPropagation(); setExpandedId(expanded ? null : order.id); }} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 px-4 pb-5 lg:px-5">
                    <div className="grid gap-6 pt-5 lg:grid-cols-2">
                      <div className="space-y-4">
                        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order Items</p>
                            <span className="text-xs font-semibold text-slate-500">{totalItems} items</span>
                          </div>
                          <div className="space-y-2">
                            {order.order_items.map((item) => (
                              <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <span className="text-sm font-semibold text-slate-900">{item.name} x{item.qty}</span>
                                <span className="text-sm font-semibold text-slate-700">Rs. {(item.price * item.qty).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Assignment</p>
                          <div className="flex gap-2">
                            <input
                              value={assignees[order.id] ?? ""}
                              onChange={(event) => setAssignees((prev) => ({ ...prev, [order.id]: event.target.value }))}
                              placeholder="Assign to kitchen or rider..."
                              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-200 focus:ring-2 focus:ring-brand/10"
                            />
                            <button onClick={() => void handleAssign(order)} disabled={savingId === order.id} className="rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">
                              Save
                            </button>
                          </div>
                        </section>
                      </div>

                      <div className="space-y-4">
                        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Order Details</p>
                          <div className="space-y-2 text-sm text-slate-700">
                            <div className="flex justify-between gap-4"><span>Placed</span><span className="font-semibold text-slate-900">{format(new Date(order.created_at), "dd MMM yyyy, hh:mm a")}</span></div>
                            <div className="flex justify-between gap-4"><span>Type</span><span className="font-semibold capitalize text-slate-900">{order.type.replace("-", " ")}</span></div>
                            {order.guests != null && <div className="flex justify-between gap-4"><span>Guests</span><span className="font-semibold text-slate-900">{order.guests}</span></div>}
                            {order.reservation_time && <div className="flex justify-between gap-4"><span>Reservation</span><span className="font-semibold text-slate-900">{format(new Date(order.reservation_time), "dd MMM, hh:mm a")}</span></div>}
                            {order.address && <div className="flex justify-between gap-4"><span>Address</span><span className="text-right font-semibold text-slate-900">{order.address}</span></div>}
                            <div className="flex justify-between gap-4"><span>Subtotal</span><span className="font-semibold text-slate-900">Rs. {Number(order.subtotal).toLocaleString()}</span></div>
                            <div className="flex justify-between gap-4"><span>Delivery Fee</span><span className="font-semibold text-slate-900">Rs. {Number(order.delivery_fee).toLocaleString()}</span></div>
                            <div className="flex justify-between gap-4 border-t border-slate-200 pt-2"><span className="font-semibold">Total</span><span className="font-bold text-slate-900">Rs. {(Number(order.subtotal) + Number(order.delivery_fee)).toLocaleString()}</span></div>
                          </div>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Notification Result</p>
                          {order.status_notification_status ? (
                            <div className="space-y-2 text-sm text-slate-700">
                              <div className="flex items-center gap-2">
                                <span className={clsx("rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide", order.status_notification_status === "sent" ? "bg-emerald-100 text-emerald-700" : order.status_notification_status === "failed" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600")}>
                                  {order.status_notification_status}
                                </span>
                                {order.status_notified_at && <span className="text-xs text-slate-500">{formatDistanceToNow(new Date(order.status_notified_at), { addSuffix: true })}</span>}
                              </div>
                              {order.status_notification_error && <p className="text-xs text-slate-500">{order.status_notification_error}</p>}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">No customer status notification has been recorded yet.</p>
                          )}
                        </section>
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
