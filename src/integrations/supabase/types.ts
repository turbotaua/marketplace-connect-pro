export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      category_mapping: {
        Row: {
          created_at: string
          epicentr_category_code: string | null
          id: string
          marketplace_category_id: string
          marketplace_category_name: string | null
          marketplace_id: string
          portal_id: string | null
          rz_id: string | null
          shopify_collection_id: string
          shopify_collection_title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          epicentr_category_code?: string | null
          id?: string
          marketplace_category_id: string
          marketplace_category_name?: string | null
          marketplace_id: string
          portal_id?: string | null
          rz_id?: string | null
          shopify_collection_id: string
          shopify_collection_title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          epicentr_category_code?: string | null
          id?: string
          marketplace_category_id?: string
          marketplace_category_name?: string | null
          marketplace_id?: string
          portal_id?: string | null
          rz_id?: string | null
          shopify_collection_id?: string
          shopify_collection_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_mapping_marketplace_id_fkey"
            columns: ["marketplace_id"]
            isOneToOne: false
            referencedRelation: "marketplace_config"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          marketplace_slug: string
          product_count: number | null
          status: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          marketplace_slug: string
          product_count?: number | null
          status?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          marketplace_slug?: string
          product_count?: number | null
          status?: string
        }
        Relationships: []
      }
      marketplace_config: {
        Row: {
          created_at: string
          feed_url: string | null
          global_multiplier: number
          id: string
          is_active: boolean
          name: string
          rounding_rule: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          feed_url?: string | null
          global_multiplier?: number
          id?: string
          is_active?: boolean
          name: string
          rounding_rule?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          feed_url?: string | null
          global_multiplier?: number
          id?: string
          is_active?: boolean
          name?: string
          rounding_rule?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      price_multipliers: {
        Row: {
          created_at: string
          id: string
          marketplace_id: string
          multiplier: number
          shopify_collection_id: string
          shopify_collection_title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          marketplace_id: string
          multiplier?: number
          shopify_collection_id: string
          shopify_collection_title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          marketplace_id?: string
          multiplier?: number
          shopify_collection_id?: string
          shopify_collection_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_multipliers_marketplace_id_fkey"
            columns: ["marketplace_id"]
            isOneToOne: false
            referencedRelation: "marketplace_config"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_errors: {
        Row: {
          created_at: string
          error_message: string
          error_type: string
          feed_log_id: string | null
          id: string
          marketplace_slug: string
          product_sku: string | null
          product_title: string | null
        }
        Insert: {
          created_at?: string
          error_message: string
          error_type: string
          feed_log_id?: string | null
          id?: string
          marketplace_slug: string
          product_sku?: string | null
          product_title?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string
          error_type?: string
          feed_log_id?: string | null
          id?: string
          marketplace_slug?: string
          product_sku?: string | null
          product_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "validation_errors_feed_log_id_fkey"
            columns: ["feed_log_id"]
            isOneToOne: false
            referencedRelation: "feed_logs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
