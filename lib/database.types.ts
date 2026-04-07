// Database types — auto-generated stub
// To regenerate: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Shared order status union — used in Row, Insert, and Update to prevent
 * inserting invalid statuses like "banana" which TypeScript would previously
 * allow because Insert/Update had status typed as plain `string`.
 */
export type OrderStatus =
  | "received"
  | "preparing"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export interface Database {
  public: {
    Tables: {
      conversations: {
        Row: {
          id: string;
          phone: string;
          name: string | null;
          mode: "agent" | "human";
          updated_at: string;
          created_at: string;
          has_unread: boolean | null;
        };
        Insert: {
          id?: string;
          phone: string;
          name?: string | null;
          mode?: "agent" | "human";
          updated_at?: string; // Optional, defaults via DB trigger or explicitly set
          created_at?: string;
          has_unread?: boolean | null;
        };
        Update: {
          id?: string;
          phone?: string;
          name?: string | null;
          mode?: "agent" | "human";
          updated_at?: string;
          created_at?: string;
          has_unread?: boolean | null;
        };
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          whatsapp_msg_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          // Note: nullable because assistant messages do not have a whatsapp_msg_id.
          // User messages must provide this to prevent replay attacks via unique constraint.
          whatsapp_msg_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: "user" | "assistant";
          content?: string;
          whatsapp_msg_id?: string | null;
          created_at?: string;
        };
      };
      orders: {
        Row: {
          id: string;
          conversation_id: string;
          order_number: number;
          type: "delivery" | "dine-in";
          status: OrderStatus;
          subtotal: number;
          delivery_fee: number;
          total: number;
          address: string | null;
          guests: number | null;
          reservation_time: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          order_number?: number;
          type: "delivery" | "dine-in";
          // Fixed: was typed as plain `string`, allowing any value like "banana".
          // Now locked to the same OrderStatus union as the Row type.
          status?: OrderStatus;
          subtotal: number;
          delivery_fee?: number;
          total?: number;
          address?: string | null;
          guests?: number | null;
          reservation_time?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          order_number?: number;
          type?: "delivery" | "dine-in";
          // Fixed: same as Insert — was plain `string`.
          status?: OrderStatus;
          subtotal?: number;
          delivery_fee?: number;
          total?: number;
          address?: string | null;
          guests?: number | null;
          reservation_time?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          name: string;
          qty: number;
          price: number;
          // Added: every other table has created_at; order_items was missing it,
          // making it impossible to audit when items were added to an order.
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          name: string;
          qty: number;
          price: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          name?: string;
          qty?: number;
          price?: number;
          created_at?: string;
        };
      };
    };
  };
}
