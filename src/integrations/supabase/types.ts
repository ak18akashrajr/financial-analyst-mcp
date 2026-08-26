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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      cash_settings: {
        Row: {
          credit_card_debt: number
          id: string
          liquid_cash: number
          pf_balance: number
          updated_at: string
          vault_cash: number
        }
        Insert: {
          credit_card_debt?: number
          id?: string
          liquid_cash?: number
          pf_balance?: number
          updated_at?: string
          vault_cash?: number
        }
        Update: {
          credit_card_debt?: number
          id?: string
          liquid_cash?: number
          pf_balance?: number
          updated_at?: string
          vault_cash?: number
        }
        Relationships: []
      }
      current_prices: {
        Row: {
          price: number
          symbol: string
          updated_at: string
        }
        Insert: {
          price: number
          symbol: string
          updated_at?: string
        }
        Update: {
          price?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          created_at: string
          date: string
          fetched_at: string
          id: string
          pair: string
          rate: number
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          fetched_at?: string
          id?: string
          pair?: string
          rate: number
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          fetched_at?: string
          id?: string
          pair?: string
          rate?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      goal_allocations: {
        Row: {
          amount: number
          created_at: string
          goal_id: string
          id: string
          quantity: number | null
          source_type: string
          symbol: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          goal_id: string
          id?: string
          quantity?: number | null
          source_type?: string
          symbol?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          goal_id?: string
          id?: string
          quantity?: number | null
          source_type?: string
          symbol?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_allocations_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          category: string
          created_at: string
          icon: string
          id: string
          name: string
          notes: string | null
          target_amount: number
          target_date: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          notes?: string | null
          target_amount?: number
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          notes?: string | null
          target_amount?: number
          target_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      historical_prices: {
        Row: {
          close: number
          created_at: string
          date: string
          id: string
          symbol: string
        }
        Insert: {
          close: number
          created_at?: string
          date: string
          id?: string
          symbol: string
        }
        Update: {
          close?: number
          created_at?: string
          date?: string
          id?: string
          symbol?: string
        }
        Relationships: []
      }
      market_indicators: {
        Row: {
          as_of: string
          id: string
          indicator: string
          source: string | null
          updated_at: string
          value: number
        }
        Insert: {
          as_of: string
          id?: string
          indicator: string
          source?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          as_of?: string
          id?: string
          indicator?: string
          source?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      monthly_cashflow: {
        Row: {
          id: string
          total_expense: number
          total_income: number
          updated_at: string
          year_month: string
        }
        Insert: {
          id?: string
          total_expense?: number
          total_income?: number
          updated_at?: string
          year_month: string
        }
        Update: {
          id?: string
          total_expense?: number
          total_income?: number
          updated_at?: string
          year_month?: string
        }
        Relationships: []
      }
      net_worth_history: {
        Row: {
          credit_card_debt: number
          id: string
          liquid_cash: number
          net_worth: number
          pf_balance: number
          portfolio_value: number
          recorded_at: string
          vault_cash: number
        }
        Insert: {
          credit_card_debt?: number
          id?: string
          liquid_cash?: number
          net_worth: number
          pf_balance?: number
          portfolio_value?: number
          recorded_at?: string
          vault_cash?: number
        }
        Update: {
          credit_card_debt?: number
          id?: string
          liquid_cash?: number
          net_worth?: number
          pf_balance?: number
          portfolio_value?: number
          recorded_at?: string
          vault_cash?: number
        }
        Relationships: []
      }
      period_reports: {
        Row: {
          commentary: string | null
          created_at: string
          fy: string
          highlights: string | null
          id: string
          outlook: string | null
          period_key: string
          period_type: string
          risks: string | null
          updated_at: string
        }
        Insert: {
          commentary?: string | null
          created_at?: string
          fy: string
          highlights?: string | null
          id?: string
          outlook?: string | null
          period_key: string
          period_type: string
          risks?: string | null
          updated_at?: string
        }
        Update: {
          commentary?: string | null
          created_at?: string
          fy?: string
          highlights?: string | null
          id?: string
          outlook?: string | null
          period_key?: string
          period_type?: string
          risks?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      symbol_metadata: {
        Row: {
          geography: string
          sector: string
          symbol: string
          updated_at: string
        }
        Insert: {
          geography?: string
          sector?: string
          symbol: string
          updated_at?: string
        }
        Update: {
          geography?: string
          sector?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      ticker_fundamentals: {
        Row: {
          cape: number | null
          eps_10y: Json | null
          sector: string | null
          symbol: string
          updated_at: string
        }
        Insert: {
          cape?: number | null
          eps_10y?: Json | null
          sector?: string | null
          symbol: string
          updated_at?: string
        }
        Update: {
          cape?: number | null
          eps_10y?: Json | null
          sector?: string | null
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          created_at: string
          date: string
          id: string
          price: number
          quantity: number
          symbol: string
          type: string
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          price: number
          quantity: number
          symbol: string
          type: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          price?: number
          quantity?: number
          symbol?: string
          type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
