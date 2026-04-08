"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Send, Bot, User, Search, MessageSquare, ArrowLeft, MoreVertical, Sparkles
} from "lucide-react";
import { clsx } from "clsx";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

interface Conversation {
  id: string;
  phone: string;
  name: string;
  mode: "agent" | "human";
  has_unread: boolean;
  updated_at: string;
  messages?: { content: string; role: string; created_at: string }[];
  conversation_states?:
    | { workflow_step: string; order_type: string | null }
    | Array<{ workflow_step: string; order_type: string | null }>
    | null;
}

interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const getInitials = (name?: string) => {
  if (!name) return "#";
  return name.substring(0, 2).toUpperCase();
};

const getWorkflowLabel = (conversation: Conversation): string | null => {
  const rawState = Array.isArray(conversation.conversation_states)
    ? conversation.conversation_states[0]
    : conversation.conversation_states;

  if (!rawState || rawState.workflow_step === "idle") return null;

  const labels: Record<string, string> = {
    collecting_items: "Building cart",
    awaiting_upsell_reply: "Waiting on add-on",
    awaiting_order_type: "Waiting on order type",
    awaiting_delivery_address: "Waiting on address",
    awaiting_dine_in_details: "Waiting on dine-in details",
    awaiting_confirmation: "Waiting on confirmation",
  };

  return labels[rawState.workflow_step] ?? rawState.workflow_step;
};

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedConv = conversations.find((c) => c.id === selectedId);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { headers: { "ngrok-skip-browser-warning": "69420" } });
      if (res.ok) {
        const data = await res.json();
        setConversations(data || []);
      }
    } catch (err) {
      console.error("Failed to load conversations", err);
    }
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ has_unread: false }),
      });
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, has_unread: false } : c))
      );
    } catch (err) {
      console.error("Failed to mark as read", err);
    }
  };

  const loadMessages = useCallback(async (id: string, isUnread: boolean) => {
    if (isUnread) markAsRead(id);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(prev => {
          if (prev.length === data.length && prev[prev.length - 1]?.id === data[data.length - 1]?.id) {
            return prev;
          }
          return data || [];
        });
      }
    } catch (err) {
      console.error("Failed to load messages", err);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (selectedId) {
      const conv = conversations.find((c) => c.id === selectedId);
      loadMessages(selectedId, !!conv?.has_unread);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const channel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const newMsg = payload.new as Message;
          if (newMsg.conversation_id === selectedId) {
            setMessages((prev) => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            if (newMsg.role === "user") markAsRead(selectedId);
          }
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId, loadConversations]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (selectedId) {
      interval = setInterval(() => {
        loadMessages(selectedId, false);
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    }
  }, [selectedId, loadMessages]);

  const toggleMode = async () => {
    if (!selectedConv) return;
    const newMode = selectedConv.mode === "agent" ? "human" : "agent";

    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, mode: newMode } : c))
    );

    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast.success(newMode === "agent" ? "AI Agent active." : "Manual control active.");
    } catch {
      toast.error("Failed to switch mode");
      loadConversations();
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedId || sending) return;

    const text = newMessage.trim();
    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: selectedId,
      role: "assistant",
      content: text,
      created_at: new Date().toISOString()
    };

    setMessages((prev) => [...prev, tempMsg]);
    setNewMessage("");
    setSending(true);

    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (res.ok) {
        const msg = await res.json();
        setMessages((prev) => prev.map(m => m.id === tempMsg.id ? msg : m));
        loadConversations();
      } else {
        throw new Error("Send failed");
      }
    } catch {
      toast.error("Failed to send message.");
      setMessages((prev) => prev.filter(m => m.id !== tempMsg.id));
      setNewMessage(text);
    } finally {
      setSending(false);
    }
  };

  const filteredConv = conversations
    .filter(
      (c) =>
        c.name?.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search)
    )
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    // Wrapped in a floating card design that fits perfectly within the main dashboard
    <div className="h-[calc(100vh-8rem)] min-h-[600px] w-full bg-white rounded-2xl border border-slate-200 shadow-sm flex overflow-hidden text-slate-900 font-sans">

      {/* Sidebar Inbox */}
      <div className={clsx(
        "w-full md:w-[340px] flex-shrink-0 flex flex-col bg-slate-50/50 border-r border-slate-200 transition-transform duration-300",
        selectedId ? "hidden md:flex" : "flex"
      )}>
        <div className="h-16 flex items-center px-4 border-b border-slate-200 shrink-0 bg-white z-10">
          <div className="relative w-full group">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand transition-colors" />
            <input
              className="w-full bg-slate-100 border border-transparent focus:bg-white focus:border-orange-200 focus:ring-2 focus:ring-brand/20 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-500 transition-all shadow-sm"
              placeholder="Search chats..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col pt-3 px-3 gap-1.5 pb-4">
          {filteredConv.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 opacity-60">
              <MessageSquare size={24} className="mb-3 text-slate-400" />
              <p className="text-sm font-medium text-slate-500">Inbox zero</p>
            </div>
          ) : (
            filteredConv.map((conv) => {
              const lastMsg = conv.messages?.[0];
              const isActive = selectedId === conv.id;
              const workflowLabel = getWorkflowLabel(conv);

              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={clsx(
                    "w-full text-left p-3 rounded-xl transition-all group relative flex gap-3 items-center border",
                    isActive
                      ? "bg-orange-50 border-orange-100 shadow-sm"
                      : "bg-transparent border-transparent hover:bg-white hover:border-slate-200 hover:shadow-sm"
                  )}
                >
                  {/* Unread dot */}
                  {conv.has_unread && !isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-brand rounded-full shadow-[0_0_8px_rgba(234,88,12,0.6)]" />
                  )}

                  {/* Avatar Circle */}
                  <div className={clsx(
                    "w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ml-1 transition-colors",
                    isActive ? "bg-white border-orange-200 text-brand" : "bg-slate-100 border-slate-200 text-slate-500 group-hover:bg-white"
                  )}>
                    <span className="text-xs font-bold">
                      {getInitials(conv.name || conv.phone)}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0 pr-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className={clsx(
                        "text-sm font-semibold truncate tracking-tight",
                        conv.has_unread && !isActive ? "text-slate-900" : "text-slate-700",
                        isActive && "text-brand"
                      )}>
                        {conv.name ?? conv.phone}
                      </p>
                      <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap ml-2">
                        {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: false })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <p className={clsx(
                        "text-xs truncate flex-1 leading-snug",
                        conv.has_unread && !isActive ? "text-slate-700 font-medium" : "text-slate-500",
                        isActive && "text-orange-700/70"
                      )}>
                        {lastMsg?.content ?? "Started conversation"}
                      </p>
                      <div className="shrink-0" title={conv.mode === "agent" ? "AI Agent Active" : "Manual Mode"}>
                        {conv.mode === "agent"
                          ? <Bot size={14} className={isActive ? "text-emerald-500" : "text-slate-400"} />
                          : <User size={14} className={isActive ? "text-brand" : "text-slate-400"} />
                        }
                      </div>
                    </div>
                    {workflowLabel && (
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-orange-600 truncate">
                        {workflowLabel}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Panel */}
      {selectedConv ? (
        <div className={clsx(
          "flex-1 flex flex-col min-w-0 bg-[#f8fafc] relative",
          !selectedId ? "hidden md:flex" : "flex"
        )}>
          {/* Chat Header */}
          <header className="h-16 flex items-center justify-between px-4 sm:px-6 border-b border-slate-200 shrink-0 bg-white z-20 gap-4">

            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button
                className="md:hidden p-2 -ml-2 shrink-0 text-slate-400 hover:text-slate-900 transition-colors"
                onClick={() => setSelectedId(null)}
              >
                <ArrowLeft size={18} />
              </button>

              <div className="hidden sm:flex w-10 h-10 rounded-full bg-slate-100 items-center justify-center shrink-0 border border-slate-200 text-slate-600">
                <span className="text-xs font-bold">
                  {getInitials(selectedConv.name || selectedConv.phone)}
                </span>
              </div>

              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2 tracking-tight truncate">
                  {selectedConv.name ?? selectedConv.phone}
                </h2>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                  {selectedConv.phone}
                </p>
              </div>
            </div>

            {/* Mode Toggle Switch */}
            <div className="flex shrink-0 items-center gap-2 sm:gap-3 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full shadow-sm">
              <span className={clsx("hidden sm:block text-xs font-semibold transition-colors", selectedConv.mode === "human" ? "text-slate-700" : "text-slate-400")}>
                Manual
              </span>

              <button
                type="button"
                role="switch"
                aria-checked={selectedConv.mode === "agent"}
                onClick={toggleMode}
                className={clsx(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                  selectedConv.mode === "agent" ? "bg-emerald-500" : "bg-slate-300"
                )}
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                    selectedConv.mode === "agent" ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>

              <span className={clsx("text-xs font-semibold flex items-center gap-1 transition-colors", selectedConv.mode === "agent" ? "text-emerald-600" : "text-slate-400")}>
                <Sparkles size={12} /> <span className="hidden sm:inline">AI Agent</span>
              </span>
            </div>
          </header>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-hide flex flex-col gap-1.5 z-10">
            {messages.map((msg, idx) => {
              // UX FIX: The business ("assistant") messages should be on the right, the customer ("user") on the left.
              const isMe = msg.role === "assistant";
              const prevMsg = messages[idx - 1];
              const nextMsg = messages[idx + 1];

              const isFirstInGroup = !prevMsg || prevMsg.role !== msg.role;
              const isLastInGroup = !nextMsg || nextMsg.role !== msg.role;

              const showTimestamp = isFirstInGroup && (!prevMsg || new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 300000);

              return (
                <div key={msg.id} className={clsx("flex flex-col w-full", isFirstInGroup ? "mt-4" : "")}>
                  {showTimestamp && (
                    <div className="flex justify-center mb-4 mt-2">
                      <span className="text-[10px] text-slate-400 font-semibold bg-slate-200/50 px-2 py-0.5 rounded-full">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}

                  <div className={clsx(
                    "flex w-full group",
                    isMe ? "justify-end" : "justify-start"
                  )}>
                    <div className={clsx(
                      "px-4 py-2.5 max-w-[85%] md:max-w-[70%] text-[14px] sm:text-[15px] leading-relaxed transition-all shadow-sm",

                      // My messages (Orange)
                      isMe
                        ? "bg-brand text-white border border-transparent"

                        // Customer messages (White)
                        : "bg-white border border-slate-200 text-slate-800",

                      // Rounded corner logic
                      isMe && isFirstInGroup && !isLastInGroup ? "rounded-2xl rounded-tr-md" : "",
                      isMe && !isFirstInGroup && !isLastInGroup ? "rounded-2xl rounded-tr-md rounded-br-md" : "",
                      isMe && !isFirstInGroup && isLastInGroup ? "rounded-2xl rounded-br-md" : "",
                      isMe && isFirstInGroup && isLastInGroup ? "rounded-2xl" : "",

                      !isMe && isFirstInGroup && !isLastInGroup ? "rounded-2xl rounded-tl-md" : "",
                      !isMe && !isFirstInGroup && !isLastInGroup ? "rounded-2xl rounded-tl-md rounded-bl-md" : "",
                      !isMe && !isFirstInGroup && isLastInGroup ? "rounded-2xl rounded-bl-md" : "",
                      !isMe && isFirstInGroup && isLastInGroup ? "rounded-2xl" : ""
                    )}
                      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                    >
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} className="h-4" />
          </div>

          {/* Input Area */}
          <div className="p-4 shrink-0 bg-white border-t border-slate-200 z-20">
            {selectedConv.mode === "agent" ? (
              <div className="w-full flex items-center justify-between px-5 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl max-w-4xl mx-auto shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <p className="text-sm font-medium text-emerald-700">AI is actively managing this conversation.</p>
                </div>
                <button
                  onClick={toggleMode}
                  className="text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm"
                >
                  Take over
                </button>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto flex items-end gap-2 bg-slate-50 border border-slate-200 focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/10 rounded-2xl p-1.5 transition-all shadow-sm">
                <button className="p-2.5 text-slate-400 hover:text-slate-600 transition-colors shrink-0 mb-0.5">
                  <MoreVertical size={20} />
                </button>
                <textarea
                  className="flex-1 bg-transparent px-1 py-2.5 text-[15px] text-slate-900 placeholder-slate-400 outline-none resize-none max-h-32 min-h-[44px] scrollbar-hide"
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={1}
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !newMessage.trim()}
                  className="p-2.5 rounded-xl bg-brand text-white hover:bg-brand-hover disabled:opacity-50 disabled:hover:bg-brand transition-all shrink-0 mb-0.5 shadow-sm"
                >
                  <Send size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center bg-[#f8fafc]">
          <div className="text-center text-slate-500">
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-200 shadow-sm text-slate-400">
              <MessageSquare size={24} />
            </div>
            <h3 className="text-base font-semibold text-slate-900">Your Inbox</h3>
            <p className="text-sm mt-1 text-slate-500">Select a conversation to start messaging</p>
          </div>
        </div>
      )}
    </div>
  );
}
