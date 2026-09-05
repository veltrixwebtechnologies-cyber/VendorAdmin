export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_broadcasts: {
        Row: {
          audience: string;
          body: string;
          channel: string;
          id: string;
          recipient_count: number;
          sent_at: string;
          sent_by: string | null;
          target_ids: string[];
          title: string;
        };
        Insert: {
          audience?: string;
          body: string;
          channel?: string;
          id?: string;
          recipient_count?: number;
          sent_at?: string;
          sent_by?: string | null;
          target_ids?: string[];
          title: string;
        };
        Update: {
          audience?: string;
          body?: string;
          channel?: string;
          id?: string;
          recipient_count?: number;
          sent_at?: string;
          sent_by?: string | null;
          target_ids?: string[];
          title?: string;
        };
        Relationships: [];
      };
      banners: {
        Row: {
          created_at: string;
          created_by: string | null;
          ends_at: string | null;
          id: string;
          image_url: string;
          is_active: boolean;
          link_url: string | null;
          placement: string;
          sort_order: number;
          starts_at: string | null;
          subtitle: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          image_url: string;
          is_active?: boolean;
          link_url?: string | null;
          placement?: string;
          sort_order?: number;
          starts_at?: string | null;
          subtitle?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          image_url?: string;
          is_active?: boolean;
          link_url?: string | null;
          placement?: string;
          sort_order?: number;
          starts_at?: string | null;
          subtitle?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      brands: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          logo_url: string | null;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          is_active: boolean;
          name: string;
          parent_id: string | null;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          name: string;
          parent_id?: string | null;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          name?: string;
          parent_id?: string | null;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      coupons: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          discount_type: string;
          discount_value: number;
          expires_at: string | null;
          id: string;
          is_active: boolean;
          max_discount: number | null;
          min_order: number;
          starts_at: string | null;
          updated_at: string;
          usage_limit: number | null;
          used_count: number;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount_type: string;
          discount_value?: number;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_discount?: number | null;
          min_order?: number;
          starts_at?: string | null;
          updated_at?: string;
          usage_limit?: number | null;
          used_count?: number;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount_type?: string;
          discount_value?: number;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_discount?: number | null;
          min_order?: number;
          starts_at?: string | null;
          updated_at?: string;
          usage_limit?: number | null;
          used_count?: number;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          kind: string | null;
          link: string | null;
          read_at: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string | null;
          link?: string | null;
          read_at?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string | null;
          link?: string | null;
          read_at?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          line_total: number;
          order_id: string;
          product_id: string | null;
          product_name: string;
          qty: number;
          sku: string | null;
          unit_price: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          line_total?: number;
          order_id: string;
          product_id?: string | null;
          product_name: string;
          qty?: number;
          sku?: string | null;
          unit_price?: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_total?: number;
          order_id?: string;
          product_id?: string | null;
          product_name?: string;
          qty?: number;
          sku?: string | null;
          unit_price?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          awb_number: string | null;
          buyer_address: string | null;
          buyer_name: string | null;
          buyer_phone: string | null;
          courier: string | null;
          created_at: string;
          delivered_at: string | null;
          id: string;
          order_number: string;
          placed_at: string;
          seller_id: string;
          shipping_fee: number;
          status: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          total: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          awb_number?: string | null;
          buyer_address?: string | null;
          buyer_name?: string | null;
          buyer_phone?: string | null;
          courier?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          id?: string;
          order_number?: string;
          placed_at?: string;
          seller_id: string;
          shipping_fee?: number;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          total?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          awb_number?: string | null;
          buyer_address?: string | null;
          buyer_name?: string | null;
          buyer_phone?: string | null;
          courier?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          id?: string;
          order_number?: string;
          placed_at?: string;
          seller_id?: string;
          shipping_fee?: number;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          total?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "sellers";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          commission_percent: number;
          id: number;
          logo_url: string | null;
          marketplace_name: string;
          payment_gateway: string;
          privacy_policy: string | null;
          return_policy: string | null;
          shipping_flat: number;
          tax_percent: number;
          terms_conditions: string | null;
          updated_at: string;
        };
        Insert: {
          commission_percent?: number;
          id?: number;
          logo_url?: string | null;
          marketplace_name?: string;
          payment_gateway?: string;
          privacy_policy?: string | null;
          return_policy?: string | null;
          shipping_flat?: number;
          tax_percent?: number;
          terms_conditions?: string | null;
          updated_at?: string;
        };
        Update: {
          commission_percent?: number;
          id?: number;
          logo_url?: string | null;
          marketplace_name?: string;
          payment_gateway?: string;
          privacy_policy?: string | null;
          return_policy?: string | null;
          shipping_flat?: number;
          tax_percent?: number;
          terms_conditions?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          admin_notes: string | null;
          brand: string | null;
          category: string | null;
          created_at: string;
          description: string | null;
          hsn: string | null;
          id: string;
          image_url: string | null;
          images: Json | null;
          low_stock_threshold: number;
          mrp: number;
          name: string;
          rejection_reason: string | null;
          seller_id: string;
          selling_price: number;
          sku: string | null;
          status: Database["public"]["Enums"]["product_status"];
          stock: number;
          tax_rate: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          admin_notes?: string | null;
          brand?: string | null;
          category?: string | null;
          created_at?: string;
          description?: string | null;
          hsn?: string | null;
          id?: string;
          image_url?: string | null;
          images?: Json | null;
          low_stock_threshold?: number;
          mrp?: number;
          name: string;
          rejection_reason?: string | null;
          seller_id: string;
          selling_price?: number;
          sku?: string | null;
          status?: Database["public"]["Enums"]["product_status"];
          stock?: number;
          tax_rate?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          admin_notes?: string | null;
          brand?: string | null;
          category?: string | null;
          created_at?: string;
          description?: string | null;
          hsn?: string | null;
          id?: string;
          image_url?: string | null;
          images?: Json | null;
          low_stock_threshold?: number;
          mrp?: number;
          name?: string;
          rejection_reason?: string | null;
          seller_id?: string;
          selling_price?: number;
          sku?: string | null;
          status?: Database["public"]["Enums"]["product_status"];
          stock?: number;
          tax_rate?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "sellers";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          product_id: string | null;
          rating: number;
          reported_count: number;
          status: string;
          title: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string | null;
          rating: number;
          reported_count?: number;
          status?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string | null;
          rating?: number;
          reported_count?: number;
          status?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      seller_documents: {
        Row: {
          created_at: string;
          doc_type: string;
          file_name: string | null;
          file_size: number | null;
          file_url: string | null;
          id: string;
          seller_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          doc_type: string;
          file_name?: string | null;
          file_size?: number | null;
          file_url?: string | null;
          id?: string;
          seller_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          doc_type?: string;
          file_name?: string | null;
          file_size?: number | null;
          file_url?: string | null;
          id?: string;
          seller_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "seller_documents_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "sellers";
            referencedColumns: ["id"];
          },
        ];
      };
      sellers: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          admin_notes: string | null;
          bank_account_name: string | null;
          bank_account_number: string | null;
          bank_ifsc: string | null;
          bank_name: string | null;
          business_name: string | null;
          business_type: string | null;
          city: string | null;
          country: string | null;
          created_at: string;
          email: string | null;
          lat: number | null;
          full_name: string | null;
          gstin: string | null;
          hsn_default: string | null;
          id: string;
          pan: string | null;
          phone: string | null;
          lng: number | null;
          pincode: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          state: string | null;
          status: Database["public"]["Enums"]["seller_status"];
          tax_category: string | null;
          updated_at: string;
          user_id: string;
          wizard_data: Json;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          admin_notes?: string | null;
          bank_account_name?: string | null;
          bank_account_number?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          business_name?: string | null;
          business_type?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          email?: string | null;
          lat?: number | null;
          full_name?: string | null;
          gstin?: string | null;
          hsn_default?: string | null;
          id?: string;
          pan?: string | null;
          phone?: string | null;
          lng?: number | null;
          pincode?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          state?: string | null;
          status?: Database["public"]["Enums"]["seller_status"];
          tax_category?: string | null;
          updated_at?: string;
          user_id: string;
          wizard_data?: Json;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          admin_notes?: string | null;
          bank_account_name?: string | null;
          bank_account_number?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          business_name?: string | null;
          business_type?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          email?: string | null;
          lat?: number | null;
          full_name?: string | null;
          gstin?: string | null;
          hsn_default?: string | null;
          id?: string;
          pan?: string | null;
          phone?: string | null;
          lng?: number | null;
          pincode?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          state?: string | null;
          status?: Database["public"]["Enums"]["seller_status"];
          tax_category?: string | null;
          updated_at?: string;
          user_id?: string;
          wizard_data?: Json;
        };
        Relationships: [];
      };
      settlements: {
        Row: {
          commission: number;
          created_at: string;
          cycle_end: string;
          cycle_start: string;
          gross_sales: number;
          gst_on_fees: number;
          id: string;
          net_payout: number;
          paid_at: string | null;
          seller_id: string;
          status: Database["public"]["Enums"]["settlement_status"];
          updated_at: string;
          user_id: string;
          utr: string | null;
        };
        Insert: {
          commission?: number;
          created_at?: string;
          cycle_end: string;
          cycle_start: string;
          gross_sales?: number;
          gst_on_fees?: number;
          id?: string;
          net_payout?: number;
          paid_at?: string | null;
          seller_id: string;
          status?: Database["public"]["Enums"]["settlement_status"];
          updated_at?: string;
          user_id: string;
          utr?: string | null;
        };
        Update: {
          commission?: number;
          created_at?: string;
          cycle_end?: string;
          cycle_start?: string;
          gross_sales?: number;
          gst_on_fees?: number;
          id?: string;
          net_payout?: number;
          paid_at?: string | null;
          seller_id?: string;
          status?: Database["public"]["Enums"]["settlement_status"];
          updated_at?: string;
          user_id?: string;
          utr?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "settlements_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "sellers";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          assigned_to: string | null;
          body: string;
          created_at: string;
          id: string;
          priority: string;
          raised_by: string;
          status: string;
          subject: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          assigned_to?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          priority?: string;
          raised_by: string;
          status?: string;
          subject: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          assigned_to?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          priority?: string;
          raised_by?: string;
          status?: string;
          subject?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      ticket_messages: {
        Row: {
          author_id: string | null;
          body: string;
          created_at: string;
          id: string;
          is_admin: boolean;
          ticket_id: string;
        };
        Insert: {
          author_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          is_admin?: boolean;
          ticket_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          is_admin?: boolean;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      user_status: {
        Row: {
          blocked_at: string | null;
          blocked_by: string | null;
          is_blocked: boolean;
          reason: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          blocked_at?: string | null;
          blocked_by?: string | null;
          is_blocked?: boolean;
          reason?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          blocked_at?: string | null;
          blocked_by?: string | null;
          is_blocked?: boolean;
          reason?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_first_admin: { Args: never; Returns: boolean };
      has_any_admin: { Args: never; Returns: boolean };
      seed_demo_order: { Args: never; Returns: string };
    };
    Enums: {
      app_role: "admin" | "seller";
      order_status:
        "new" | "accepted" | "packed" | "shipped" | "delivered" | "cancelled" | "returned";
      product_status: "draft" | "pending" | "active" | "rejected" | "inactive";
      seller_status: "draft" | "pending" | "approved" | "rejected" | "more_info";
      settlement_status: "pending" | "processing" | "paid";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "seller"],
      order_status: ["new", "accepted", "packed", "shipped", "delivered", "cancelled", "returned"],
      product_status: ["draft", "pending", "active", "rejected", "inactive"],
      seller_status: ["draft", "pending", "approved", "rejected", "more_info"],
      settlement_status: ["pending", "processing", "paid"],
    },
  },
} as const;
