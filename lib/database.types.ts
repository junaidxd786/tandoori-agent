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
  | "awaiting_branch_selection"
  | "collecting_items"
  | "awaiting_upsell_reply"
  | "awaiting_order_type"
  | "awaiting_delivery_address"
  | "awaiting_dine_in_details"
  | "awaiting_confirmation"
  | "awaiting_resume_decision";

export type MessageSenderKind = "user" | "ai" | "human" | "system";
export type MessageDeliveryStatus = "pending" | "sent" | "failed";
export type StaffRole = "admin" | "branch_staff";

export interface Database {
  public: {
    Tables: {
      branches: {
        Row: {
          id: string;
          slug: string;
          name: string;
          address: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          address: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["branches"]["Insert"]>;
      };
      contacts: {
        Row: {
          id: string;
          phone: string;
          name: string | null;
          active_branch_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          name?: string | null;
          active_branch_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["contacts"]["Insert"]>;
      };
      conversations: {
        Row: {
          id: string;
          contact_id: string;
          branch_id: string;
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
          contact_id: string;
          branch_id: string;
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
          sender_kind: MessageSenderKind;
          content: string;
          whatsapp_msg_id: string | null;
          delivery_status: MessageDeliveryStatus | null;
          delivery_error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ingest_seq?: number;
          conversation_id: string;
          role: "user" | "assistant";
          sender_kind?: MessageSenderKind;
          content: string;
          whatsapp_msg_id?: string | null;
          delivery_status?: MessageDeliveryStatus | null;
          delivery_error?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
      };
      restaurant_settings: {
        Row: {
          id: number;
          branch_id: string;
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
          branch_id: string;
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
          branch_id: string;
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
          branch_id: string;
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
          branch_id: string;
          image_url: string;
          status: "pending" | "processing" | "completed" | "error";
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
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
          last_presented_options: Json | null;
          last_presented_options_at: string | null;
          order_type: OrderType | null;
          address: string | null;
          guests: number | null;
          reservation_time: string | null;
          upsell_item_name: string | null;
          upsell_item_price: number | null;
          upsell_offered: boolean;
          declined_upsells: Json;
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
          last_presented_options?: Json | null;
          last_presented_options_at?: string | null;
          order_type?: OrderType | null;
          address?: string | null;
          guests?: number | null;
          reservation_time?: string | null;
          upsell_item_name?: string | null;
          upsell_item_price?: number | null;
          upsell_offered?: boolean;
          declined_upsells?: Json;
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
          branch_id: string;
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
          assigned_to: string | null;
          status_notified_at: string | null;
          status_notification_status: "sent" | "failed" | "skipped" | null;
          status_notification_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
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
          assigned_to?: string | null;
          status_notified_at?: string | null;
          status_notification_status?: "sent" | "failed" | "skipped" | null;
          status_notification_error?: string | null;
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
      staff_profiles: {
        Row: {
          user_id: string;
          full_name: string | null;
          role: StaffRole;
          default_branch_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          full_name?: string | null;
          role?: StaffRole;
          default_branch_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff_profiles"]["Insert"]>;
      };
      staff_branch_access: {
        Row: {
          user_id: string;
          branch_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          branch_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff_branch_access"]["Insert"]>;
      };
    };
  };
}
