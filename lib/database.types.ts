export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type OrderStatus =
  | "received"
  | "preparing"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type OrderType = "delivery" | "dine-in";
export type LanguagePreference = "english" | "roman_urdu";

export type WorkflowStep =
  | "idle"
  | "collecting_items"
  | "awaiting_upsell_reply"
  | "awaiting_order_type"
  | "awaiting_delivery_address"
  | "awaiting_dine_in_details"
  | "awaiting_confirmation"
  | "awaiting_resume_decision";

export interface Database {
  public: {
    Tables: {
      conversations: {
        Row: {
          id: string;
          phone: string;
          name: string | null;
          mode: "agent" | "human";
          has_unread: boolean;
          staff_notes: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          name?: string | null;
          mode?: "agent" | "human";
          has_unread?: boolean;
          staff_notes?: string | null;
          updated_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Insert"]>;
      };
      messages: {
        Row: {
          id: string;
          ingest_seq: number;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          whatsapp_msg_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ingest_seq?: number;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          whatsapp_msg_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
      };
      restaurant_settings: {
        Row: {
          id: number;
          is_accepting_orders: boolean;
          opening_time: string;
          closing_time: string;
          min_delivery_amount: number;
          delivery_enabled: boolean;
          delivery_fee: number;
          updated_at: string;
        };
        Insert: {
          id?: number;
          is_accepting_orders?: boolean;
          opening_time?: string;
          closing_time?: string;
          min_delivery_amount?: number;
          delivery_enabled?: boolean;
          delivery_fee?: number;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["restaurant_settings"]["Insert"]>;
      };
      menu_items: {
        Row: {
          id: string;
          name: string;
          price: number;
          category: string | null;
          description: string | null;
          is_available: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          price: number;
          category?: string | null;
          description?: string | null;
          is_available?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["menu_items"]["Insert"]>;
      };
      menu_uploads: {
        Row: {
          id: string;
          image_url: string;
          status: "pending" | "processing" | "completed" | "error";
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          image_url: string;
          status?: "pending" | "processing" | "completed" | "error";
          error_message?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["menu_uploads"]["Insert"]>;
      };
      conversation_states: {
        Row: {
          id: string;
          conversation_id: string;
          workflow_step: WorkflowStep;
          cart: Json;
          preferred_language: LanguagePreference;
          resume_workflow_step: WorkflowStep | null;
          last_presented_category: string | null;
          last_presented_at: string | null;
          order_type: OrderType | null;
          address: string | null;
          guests: number | null;
          reservation_time: string | null;
          upsell_item_name: string | null;
          upsell_item_price: number | null;
          upsell_offered: boolean;
          summary_sent_at: string | null;
          last_user_whatsapp_msg_id: string | null;
          last_processed_user_message_id: string | null;
          last_processed_message_seq: number | null;
          last_processed_user_message_at: string | null;
          processing_token: string | null;
          processing_started_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          workflow_step?: WorkflowStep;
          cart?: Json;
          preferred_language?: LanguagePreference;
          resume_workflow_step?: WorkflowStep | null;
          last_presented_category?: string | null;
          last_presented_at?: string | null;
          order_type?: OrderType | null;
          address?: string | null;
          guests?: number | null;
          reservation_time?: string | null;
          upsell_item_name?: string | null;
          upsell_item_price?: number | null;
          upsell_offered?: boolean;
          summary_sent_at?: string | null;
          last_user_whatsapp_msg_id?: string | null;
          last_processed_user_message_id?: string | null;
          last_processed_message_seq?: number | null;
          last_processed_user_message_at?: string | null;
          processing_token?: string | null;
          processing_started_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversation_states"]["Insert"]>;
      };
      orders: {
        Row: {
          id: string;
          conversation_id: string;
          source_user_message_id: string | null;
          order_number: number;
          type: OrderType;
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
          source_user_message_id?: string | null;
          order_number?: number;
          type: OrderType;
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
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          name: string;
          qty: number;
          price: number;
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
        Update: Partial<Database["public"]["Tables"]["order_items"]["Insert"]>;
      };
    };
  };
}
