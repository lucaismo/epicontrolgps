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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      colaboradores: {
        Row: {
          created_at: string
          data_admissao: string | null
          funcao: string
          gestor: string | null
          id: string
          matricula: string
          nome: string
          observacoes: string | null
          setor: string
          status: Database["public"]["Enums"]["colaborador_status"]
          turno: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_admissao?: string | null
          funcao: string
          gestor?: string | null
          id?: string
          matricula: string
          nome: string
          observacoes?: string | null
          setor: string
          status?: Database["public"]["Enums"]["colaborador_status"]
          turno?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_admissao?: string | null
          funcao?: string
          gestor?: string | null
          id?: string
          matricula?: string
          nome?: string
          observacoes?: string | null
          setor?: string
          status?: Database["public"]["Enums"]["colaborador_status"]
          turno?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      epis: {
        Row: {
          ca: string | null
          categoria: string
          created_at: string
          custo_unitario: number
          estoque_atual: number
          estoque_minimo: number
          id: string
          localizacao: string | null
          modelo: string | null
          nome: string
          status: Database["public"]["Enums"]["epi_status"]
          tamanho: string | null
          updated_at: string
        }
        Insert: {
          ca?: string | null
          categoria: string
          created_at?: string
          custo_unitario?: number
          estoque_atual?: number
          estoque_minimo?: number
          id?: string
          localizacao?: string | null
          modelo?: string | null
          nome: string
          status?: Database["public"]["Enums"]["epi_status"]
          tamanho?: string | null
          updated_at?: string
        }
        Update: {
          ca?: string | null
          categoria?: string
          created_at?: string
          custo_unitario?: number
          estoque_atual?: number
          estoque_minimo?: number
          id?: string
          localizacao?: string | null
          modelo?: string | null
          nome?: string
          status?: Database["public"]["Enums"]["epi_status"]
          tamanho?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inventario_itens: {
        Row: {
          diferenca: number | null
          epi_id: string
          id: string
          inventario_id: string
          quantidade_contada: number | null
          quantidade_sistema: number
        }
        Insert: {
          diferenca?: number | null
          epi_id: string
          id?: string
          inventario_id: string
          quantidade_contada?: number | null
          quantidade_sistema?: number
        }
        Update: {
          diferenca?: number | null
          epi_id?: string
          id?: string
          inventario_id?: string
          quantidade_contada?: number | null
          quantidade_sistema?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventario_itens_epi_id_fkey"
            columns: ["epi_id"]
            isOneToOne: false
            referencedRelation: "epis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_itens_inventario_id_fkey"
            columns: ["inventario_id"]
            isOneToOne: false
            referencedRelation: "inventarios"
            referencedColumns: ["id"]
          },
        ]
      }
      inventarios: {
        Row: {
          data_fim: string | null
          data_inicio: string
          id: string
          local: string
          responsavel: string | null
          status: Database["public"]["Enums"]["inventario_status"]
        }
        Insert: {
          data_fim?: string | null
          data_inicio?: string
          id?: string
          local: string
          responsavel?: string | null
          status?: Database["public"]["Enums"]["inventario_status"]
        }
        Update: {
          data_fim?: string | null
          data_inicio?: string
          id?: string
          local?: string
          responsavel?: string | null
          status?: Database["public"]["Enums"]["inventario_status"]
        }
        Relationships: []
      }
      movimentacoes: {
        Row: {
          colaborador_id: string | null
          data_movimentacao: string
          epi_id: string
          id: string
          motivo: string | null
          observacao: string | null
          quantidade: number
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_responsavel: string | null
        }
        Insert: {
          colaborador_id?: string | null
          data_movimentacao?: string
          epi_id: string
          id?: string
          motivo?: string | null
          observacao?: string | null
          quantidade: number
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_responsavel?: string | null
        }
        Update: {
          colaborador_id?: string | null
          data_movimentacao?: string
          epi_id?: string
          id?: string
          motivo?: string | null
          observacao?: string | null
          quantidade?: number
          tipo?: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_responsavel?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_epi_id_fkey"
            columns: ["epi_id"]
            isOneToOne: false
            referencedRelation: "epis"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          nome: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "tecnico" | "almoxarife" | "lider"
      colaborador_status: "ativo" | "afastado" | "desligado"
      epi_status: "ativo" | "inativo"
      inventario_status: "em_andamento" | "finalizado"
      movimentacao_tipo:
        | "entrega"
        | "devolucao_normal"
        | "avariado"
        | "descarte"
        | "troca"
        | "perda"
        | "entrada_estoque"
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
    Enums: {
      app_role: ["admin", "tecnico", "almoxarife", "lider"],
      colaborador_status: ["ativo", "afastado", "desligado"],
      epi_status: ["ativo", "inativo"],
      inventario_status: ["em_andamento", "finalizado"],
      movimentacao_tipo: [
        "entrega",
        "devolucao_normal",
        "avariado",
        "descarte",
        "troca",
        "perda",
        "entrada_estoque",
      ],
    },
  },
} as const
