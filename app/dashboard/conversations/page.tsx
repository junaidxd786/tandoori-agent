"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { format, formatDistanceToNow, isSameDay } from "date-fns";
import {
  ArrowLeft,
  Bot,
  Loader2,
  Package,
  Phone,
  RefreshCw,
  Search,
  SendHorizonal,
  ShoppingCart,
  Sparkles,
  UserRound,
  Users,
  X,
  MessageSquareText
} from "lucide-react";
import { toast } from "sonner";
import { useDashboardContext } from "@/app/components/dashboard/DashboardProvider";

// --- Types & Helpers ---
type ConversationMode = "agent" | "human";
type SenderKind = "user" | "ai" | "human" | "system" | string;

interface ConversationState {
  workflow_step: string | null;
  order_type: string | null;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  cart: unknown;
  last_error: string | null;
}

interface UserSessionState {
  active_node: string | null;
  status: string | null;
  is_bot_active: boolean | null;
  invalid_step_count: number | null;
  escalation_reason: string | null;
  escalated_at: string | null;
}

interface ConversationPreview {
  id: string;
  branch_id: string;
  phone: string;
  name: string | null;
  mode: ConversationMode;
  has_unread: boolean;
  updated_at: string;
  created_at: string;
  branches?: { id: string; name: string; slug: string; address: string } | null;
  conversation_states?: ConversationState | ConversationState[] | null;
  user_sessions?: UserSessionState | UserSessionState[] | null;
  messages?: Array<{
    content: string;
    role: string;
    sender_kind: SenderKind;
    delivery_status?: string | null;
    created_at: string;
  }>;
}

type ConversationDetail = Omit<ConversationPreview, "messages">;

interface Message {
  id: string;
  ingest_seq: number;
  conversation_id: string;
  role: string;
  sender_kind: SenderKind;
  content: string;
  whatsapp_msg_id?: string | null;
  created_at: string;
  delivery_status?: string | null;
  delivery_error?: string | null;
}

interface MessageResponse {
  messages: Message[];
  hasMore: boolean;
}

interface DraftLine {
  name: string;
  qty: number;
  notes?: string | null;
}

function pickState(
  state?: ConversationState | ConversationState[] | null
): ConversationState | null {
  if (!state) return null;
  return Array.isArray(state) ? state[0] ?? null : state;
}

function pickSession(
  session?: UserSessionState | UserSessionState[] | null
): UserSessionState | null {
  if (!session) return null;
  return Array.isArray(session) ? session[0] ?? null : session;
}

// --- UPDATED TYPING HERE TO FIX TS ERRORS ---
function getDraftLines(cart: unknown): DraftLine[] {
  const rawItems =
    Array.isArray(cart) ? cart : cart && typeof cart === "object" && Array.isArray((cart as { items?: unknown[] }).items)
      ? (cart as { items: unknown[] }).items
      : [];

  return rawItems
    .map((item): DraftLine | null => {
      if (!item || typeof item !== "object") return null;
      
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? record.title ?? record.item ?? "").trim();
      const qty = Number(record.qty ?? record.quantity ?? 1);
      const notes = typeof record.notes === "string" ? record.notes : null;
      
      if (!name) return null;
      
      return { 
        name, 
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1, 
        notes 
      };
    })
    .filter((line): line is DraftLine => line !== null);
}

function getConversationLabel(conversation: ConversationPreview | ConversationDetail | null) {
  if (!conversation) return "Unknown customer";
  return conversation.name?.trim() || conversation.phone;
}

function getConversationInitials(conversation: ConversationPreview | ConversationDetail | null) {
  const label = getConversationLabel(conversation);
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "CU";
}

function getPreviewMessage(conversation: ConversationPreview) {
  const latest = conversation.messages?.[0];
  if (!latest?.content) return "No messages yet";
  return latest.content.length > 90 ? `${latest.content.slice(0, 90)}...` : latest.content;
}

function formatStep(step: string | null | undefined) {
  if (!step) return "No active workflow";
  return step.replaceAll("_", " ");
}

function formatMessageDay(dateText: string) {
  return format(new Date(dateText), "EEEE, dd MMM");
}

function compareMessagesByTimeline(left: Message, right: Message) {
  const leftTime = new Date(left.created_at).getTime();
  const rightTime = new Date(right.created_at).getTime();
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (leftValid && !rightValid) return -1;
  if (!leftValid && rightValid) return 1;

  return left.ingest_seq - right.ingest_seq;
}

function mergeAndSortMessages(items: Message[]) {
  const byId = new Map<string, Message>();
  for (const item of items) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort(compareMessagesByTimeline);
}

export default function ConversationsPage() {
  const { selectedBranchId, selectedBranch } = useDashboardContext();
  // --- State & Logic ---
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [composer, setComposer] = useState("");
  
  const selectedIdRef = useRef<string | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoadingList(true);

    try {
      const branchQuery = selectedBranchId === "all" ? "" : `&branch_id=${encodeURIComponent(selectedBranchId)}`;
      const response = await fetch(`/api/conversations?limit=100${branchQuery}`, {
        cache: "no-store",
        headers: { "ngrok-skip-browser-warning": "69420" },
      });
      if (!response.ok) throw new Error("Failed to load conversations");
      const data = (await response.json()) as ConversationPreview[];
      setConversations(data);
      setSelectedId((current) => (data.some((item) => item.id === current) ? current : data[0]?.id ?? null));
    } catch (error) {
      console.error(error);
      toast.error("Failed to load conversations.");
    } finally {
      setLoadingList(false);
      setRefreshing(false);
    }
  }, [selectedBranchId]);

  const loadConversation = useCallback(async (conversationId: string) => {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      cache: "no-store",
      headers: { "ngrok-skip-browser-warning": "69420" },
    });

    if (!response.ok) throw new Error("Failed to load conversation");
    setConversation((await response.json()) as ConversationDetail);
  }, []);

  const loadMessages = useCallback(async (conversationId: string, beforeSeq?: number) => {
    const isOlderRequest = typeof beforeSeq === "number";
    if (isOlderRequest) {
      setLoadingOlder(true);
      shouldStickToBottomRef.current = false;
    } else {
      setLoadingMessages(true);
      shouldStickToBottomRef.current = true;
    }

    try {
      const params = new URLSearchParams({ limit: "50" });
      if (beforeSeq != null) params.set("before_seq", String(beforeSeq));
      const response = await fetch(`/api/conversations/${conversationId}/messages?${params.toString()}`, {
        cache: "no-store",
        headers: { "ngrok-skip-browser-warning": "69420" },
      });
      if (!response.ok) throw new Error("Failed to load messages");

      const data = (await response.json()) as MessageResponse;
      setMessages((current) => mergeAndSortMessages(isOlderRequest ? [...data.messages, ...current] : data.messages));
      setHasMoreMessages(data.hasMore);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load messages.");
    } finally {
      setLoadingMessages(false);
      setLoadingOlder(false);
    }
  }, []);

  const markConversationRead = useCallback(async (conversationId: string) => {
    setConversations((current) =>
      current.map((item) => (item.id === conversationId ? { ...item, has_unread: false } : item))
    );

    try {
      await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ has_unread: false }),
      });
    } catch {
      // Realtime sync will repair the UI on the next refresh.
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setConversation(null);
      setMessages([]);
      return;
    }

    void loadConversation(selectedId);
    void loadMessages(selectedId);
    void markConversationRead(selectedId);
  }, [loadConversation, loadMessages, markConversationRead, selectedId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadConversations(true);
      if (selectedIdRef.current) void loadConversation(selectedIdRef.current);
      if (selectedIdRef.current) void loadMessages(selectedIdRef.current);
    }, 12000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadConversation, loadConversations, loadMessages]);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const filteredConversations = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return conversations.filter((item) => {
      if (!query) return true;

      const latest = item.messages?.[0]?.content ?? "";
      const step = pickState(item.conversation_states)?.workflow_step ?? "";
      return [item.name ?? "", item.phone, latest, step].some((value) => value.toLowerCase().includes(query));
    });
  }, [conversations, searchTerm]);

  const activePreview = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? null,
    [conversations, selectedId]
  );
  const activeConversation = conversation ?? activePreview;
  const activeState = pickState(activeConversation?.conversation_states);
  const activeSession = pickSession(activeConversation?.user_sessions);
  const draftLines = getDraftLines(activeState?.cart);
  const draftItemCount = draftLines.reduce((sum, item) => sum + item.qty, 0);
  const oldestLoadedIngestSeq = useMemo(() => {
    if (messages.length === 0) return null;
    return messages.reduce((min, item) => Math.min(min, item.ingest_seq), messages[0].ingest_seq);
  }, [messages]);

  const handleSend = async () => {
    if (!selectedId || !composer.trim()) return;
    setSending(true);
    shouldStickToBottomRef.current = true;

    try {
      const response = await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: composer.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to send message");

      setComposer("");
      await Promise.all([loadMessages(selectedId), loadConversations(true), loadConversation(selectedId)]);
      toast.success("Message sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const handleModeChange = async (mode: ConversationMode) => {
    if (!selectedId || activeConversation?.mode === mode) return;
    setModeSaving(true);

    try {
      const response = await fetch(`/api/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to update mode");

      await Promise.all([loadConversation(selectedId), loadConversations(true), loadMessages(selectedId)]);
      toast.success(mode === "human" ? "Conversation handed to a human." : "AI agent re-enabled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update mode.");
    } finally {
      setModeSaving(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans text-slate-900">
      
      {/* 1. SIDEBAR INBOX - Reduced width to lg:w-[300px] */}
      <aside
        className={clsx(
          "flex shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-300 ease-in-out",
          selectedId ? "hidden w-full lg:flex lg:w-[300px]" : "flex w-full lg:w-[300px]"
        )}
      >
        <div className="flex-shrink-0 border-b border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between pb-4">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Inbox</h1>
            <button
              onClick={() => void loadConversations(true)}
              disabled={loadingList || refreshing}
              className="inline-flex h-8 items-center justify-center rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50"
            >
              <RefreshCw size={14} className={clsx("mr-1.5", (loadingList || refreshing) && "animate-spin")} />
              Sync
            </button>
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search chats..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition-all focus:border-brand/50 focus:bg-white focus:ring-2 focus:ring-brand/10"
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {selectedBranch ? `Viewing ${selectedBranch.name}` : "Viewing all accessible branches"}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 overscroll-contain">
          {loadingList && conversations.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="mt-10 text-center text-slate-500">
              <MessageSquareText size={32} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No conversations found.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredConversations.map((item) => {
                const state = pickState(item.conversation_states);
                const session = pickSession(item.user_sessions);
                const isActive = item.id === selectedId;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setDetailsOpen(false);
                    }}
                    className={clsx(
                      "w-full rounded-xl p-3 text-left transition-all",
                      isActive
                        ? "bg-brand text-white shadow-md"
                        : "bg-transparent hover:bg-slate-100"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={clsx(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                        isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"
                      )}>
                        {getConversationInitials(item)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={clsx("truncate text-sm font-semibold", isActive ? "text-white" : "text-slate-900")}>
                            {getConversationLabel(item)}
                          </p>
                          <span className={clsx("shrink-0 text-[11px]", isActive ? "text-white/80" : "text-slate-400")}>
                            {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className={clsx("mt-1 line-clamp-1 text-xs", isActive ? "text-white/90" : "text-slate-500")}>
                          {getPreviewMessage(item)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.has_unread && <span className="h-2 w-2 rounded-full bg-red-500 self-center" />}
                          {item.branches?.name ? (
                            <span className={clsx("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                              isActive ? "bg-white/10 text-white/90" : "bg-blue-50 text-blue-700"
                            )}>
                              {item.branches.name}
                            </span>
                          ) : null}
                          <span className={clsx("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", 
                            isActive 
                              ? item.mode === "agent" ? "bg-white/20 text-white" : "bg-amber-400/20 text-amber-100"
                              : item.mode === "agent" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                          )}>
                            {item.mode === "agent" ? <Bot size={10} /> : <UserRound size={10} />}
                            {item.mode === "agent" ? "AI" : "Human"}
                          </span>
                          {state?.workflow_step && (
                            <span className={clsx("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                              isActive ? "bg-white/10 text-white/90" : "bg-slate-100 text-slate-500"
                            )}>
                              {formatStep(state.workflow_step)}
                            </span>
                          )}
                          {session?.status === "human_handoff" && (
                            <span className={clsx("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                              isActive ? "bg-amber-300/20 text-amber-50" : "bg-amber-100 text-amber-700"
                            )}>
                              Handoff
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* 2. MAIN CHAT AREA */}
      <main className={clsx(
        "flex min-w-0 flex-1 flex-col bg-white",
        !selectedId ? "hidden lg:flex" : "flex"
      )}>
        {!activeConversation ? (
          <div className="flex h-full flex-col items-center justify-center bg-slate-50/50 text-slate-400">
            <MessageSquareText size={48} className="mb-4 opacity-20" />
            <p className="text-lg font-medium text-slate-500">Select a conversation to start</p>
            <p className="text-sm">Choose from the inbox on the left.</p>
          </div>
        ) : (
          <>
            <header className="flex-shrink-0 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-md sm:px-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => setSelectedId(null)} className="mr-1 rounded-full p-2 hover:bg-slate-100 lg:hidden">
                    <ArrowLeft size={18} className="text-slate-600" />
                  </button>
                  <div className="hidden h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand sm:flex font-bold">
                    {getConversationInitials(activeConversation)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 leading-none">
                      {getConversationLabel(activeConversation)}
                    </h2>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <a href={`tel:${activeConversation.phone}`} className="flex items-center gap-1 hover:text-brand">
                        <Phone size={10} /> {activeConversation.phone}
                      </a>
                      <span>&bull;</span>
                      <span className="flex items-center gap-1">
                        <Sparkles size={10} className="text-brand" /> {formatStep(activeState?.workflow_step)}
                      </span>
                      {activeSession?.status === "human_handoff" && (
                        <>
                          <span>&bull;</span>
                          <span className="text-amber-600">{activeSession.escalation_reason ?? "Human handoff active"}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Redesigned AI/Human Switch with Icons & Loading State */}
                  <div className="hidden items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 sm:flex">
                    {(["agent", "human"] as ConversationMode[]).map((mode) => {
                      const isActive = activeConversation.mode === mode;
                      // Display spinner if we are saving and this is the target mode we just clicked
                      const isTargetLoading = modeSaving && !isActive; 
                      
                      return (
                        <button
                          key={mode}
                          onClick={() => void handleModeChange(mode)}
                          disabled={modeSaving}
                          className={clsx(
                            "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                            isActive
                              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/50"
                              : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
                          )}
                        >
                          {isTargetLoading ? (
                            <Loader2 size={14} className="animate-spin text-brand" />
                          ) : mode === "agent" ? (
                            <Bot size={14} className={clsx(isActive ? "text-emerald-500" : "text-slate-400")} />
                          ) : (
                            <UserRound size={14} className={clsx(isActive ? "text-amber-500" : "text-slate-400")} />
                          )}
                          <span>{mode === "agent" ? "AI" : "Human"}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => setDetailsOpen(true)}
                    className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 sm:px-4 sm:py-2"
                  >
                    <span className="hidden text-sm font-semibold sm:block">View Draft</span>
                    <ShoppingCart size={18} className="sm:hidden" />
                    {draftItemCount > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white sm:hidden">
                        {draftItemCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-6 sm:px-6">
              {hasMoreMessages && (
                <div className="mb-6 flex justify-center">
                  <button
                    onClick={() => selectedId && oldestLoadedIngestSeq != null && void loadMessages(selectedId, oldestLoadedIngestSeq)}
                    disabled={loadingOlder || oldestLoadedIngestSeq == null}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-slate-500 shadow-sm ring-1 ring-inset ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {loadingOlder ? "Loading..." : "Load older messages"}
                  </button>
                </div>
              )}

              {loadingMessages && messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-slate-300" />
                </div>
              ) : (
                <div className="mx-auto max-w-4xl space-y-6">
                  {messages.map((message, index) => {
                    const currentDate = new Date(message.created_at);
                    const previousDate = index > 0 ? new Date(messages[index - 1].created_at) : null;
                    const showDayDivider = !previousDate || !isSameDay(currentDate, previousDate);
                    const isIncoming = message.sender_kind === "user";
                    const isSystem = message.sender_kind === "system";
                    const isHuman = message.sender_kind === "human";

                    return (
                      <div key={message.id}>
                        {showDayDivider && (
                          <div className="mb-6 mt-2 flex items-center justify-center">
                            <span className="rounded-full bg-slate-200/50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                              {formatMessageDay(message.created_at)}
                            </span>
                          </div>
                        )}

                        {isSystem ? (
                          <div className="flex justify-center">
                            <div className="max-w-md rounded-xl bg-amber-50 px-4 py-2 text-center text-xs text-amber-800 ring-1 ring-inset ring-amber-200/50">
                              {message.content}
                            </div>
                          </div>
                        ) : (
                          <div className={clsx("flex", isIncoming ? "justify-start" : "justify-end")}>
                            <div className={clsx(
                                "relative max-w-[85%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed shadow-sm sm:max-w-[75%]",
                                isIncoming
                                  ? "rounded-tl-sm bg-white text-slate-800 ring-1 ring-inset ring-slate-100"
                                  : isHuman
                                    ? "rounded-tr-sm bg-brand text-white"
                                    : "rounded-tr-sm bg-slate-800 text-white"
                              )}
                            >
                              <div className={clsx(
                                "mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
                                isIncoming ? "text-slate-400" : "text-white/60"
                              )}>
                                {isIncoming ? <UserRound size={10} /> : isHuman ? <Users size={10} /> : <Bot size={10} />}
                                {isIncoming ? "Customer" : isHuman ? "You" : "AI"}
                                <span className="ml-2 font-medium normal-case tracking-normal opacity-70">
                                  {format(currentDate, "h:mm a")}
                                </span>
                              </div>
                              <div className="whitespace-pre-wrap">{message.content}</div>
                              {(message.delivery_status || message.delivery_error) && (
                                <div className={clsx("mt-2 text-[10px] italic", isIncoming ? "text-slate-400" : "text-white/50")}>
                                  {message.delivery_error ? `Error: ${message.delivery_error}` : message.delivery_status}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={endRef} className="h-2" />
                </div>
              )}
            </div>

            {/* Floating Composer */}
            <div className="flex-shrink-0 bg-white p-4 sm:p-6 sm:pt-4 border-t border-slate-100">
              <div className="mx-auto max-w-4xl">
                {activeConversation.mode === "agent" ? (
                  /* --- AI ACTIVE BANNER --- */
                  <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 py-6 text-center transition-all hover:border-slate-300">
                    <Bot size={24} className="mb-2 text-slate-400" />
                    <p className="text-sm font-medium text-slate-600">AI is currently handling this chat.</p>
                    <button
                      onClick={() => void handleModeChange("human")}
                      disabled={modeSaving}
                      className="mt-3 inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 transition-all hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
                    >
                      {modeSaving ? (
                        <Loader2 size={16} className="mr-2 animate-spin text-slate-400" />
                      ) : (
                        <UserRound size={16} className="mr-2 text-slate-400" />
                      )}
                      Take over to send a message
                    </button>
                  </div>
                ) : (
                  /* --- HUMAN INPUT FIELD --- */
                  <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                    <textarea
                      value={composer}
                      onChange={(event) => setComposer(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleSend();
                        }
                      }}
                      rows={1}
                      style={{ minHeight: '60px', maxHeight: '200px' }}
                      placeholder="Type a message... (Press Enter to send)"
                      className="w-full resize-none bg-transparent px-4 py-4 text-[15px] outline-none"
                    />
                    <div className="flex items-center justify-between bg-slate-50 px-4 py-2 border-t border-slate-100">
                      <span className="text-xs text-slate-400">
                        Manual mode active. The AI is paused.
                      </span>
                      <button
                        onClick={() => void handleSend()}
                        disabled={sending || !composer.trim()}
                        className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-50"
                      >
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <SendHorizonal size={16} className="mr-2" />}
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* 3. SLIDE-OVER DRAFT PANEL */}
      {detailsOpen && activeConversation && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/20 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-sm animate-in slide-in-from-right bg-white shadow-2xl sm:border-l border-slate-200 h-screen flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="font-bold text-slate-900">Current Draft</h3>
                <p className="text-xs text-slate-500">Active context for this chat</p>
              </div>
              <button onClick={() => setDetailsOpen(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {draftLines.length === 0 ? (
                <div className="text-center text-slate-400 mt-10">
                  <Package size={32} className="mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No items in the draft yet.</p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {draftLines.map((line, i) => (
                    <li key={i} className="flex items-start justify-between rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <div>
                        <p className="font-semibold text-slate-900">{line.name}</p>
                        {line.notes && <p className="mt-1 text-xs text-slate-500">{line.notes}</p>}
                      </div>
                      <span className="flex h-6 min-w-[24px] items-center justify-center rounded bg-white px-2 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200">
                        x{line.qty}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
