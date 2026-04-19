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
      access_requests: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          expires_at: string | null
          id: string
          location_hint: string | null
          node_id: string
          node_name: string | null
          pending_expires_at: string | null
          request_reason: string | null
          requested_at: string
          requester_id: string
          requester_identity: string | null
          revoked_at: string | null
          session_token: string | null
          status_reason_code: string | null
          status_reason_message: string | null
          status: string
          token_bound_node_id: string
          token_bound_requester_id: string
          token_single_use: boolean
          token_used_at: string | null
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string | null
          id?: string
          location_hint?: string | null
          node_id: string
          node_name?: string | null
          pending_expires_at?: string | null
          request_reason?: string | null
          requested_at?: string
          requester_id: string
          requester_identity?: string | null
          revoked_at?: string | null
          session_token?: string | null
          status_reason_code?: string | null
          status_reason_message?: string | null
          status?: string
          token_bound_node_id?: string
          token_bound_requester_id?: string
          token_single_use?: boolean
          token_used_at?: string | null
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string | null
          id?: string
          location_hint?: string | null
          node_id?: string
          node_name?: string | null
          pending_expires_at?: string | null
          request_reason?: string | null
          requested_at?: string
          requester_id?: string
          requester_identity?: string | null
          revoked_at?: string | null
          session_token?: string | null
          status_reason_code?: string | null
          status_reason_message?: string | null
          status?: string
          token_bound_node_id?: string
          token_bound_requester_id?: string
          token_single_use?: boolean
          token_used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "desktop_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          event_type: string | null
          id: string
          metadata: Json | null
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          event_type?: string | null
          id?: string
          metadata?: Json | null
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          event_type?: string | null
          id?: string
          metadata?: Json | null
          target?: string | null
        }
        Relationships: []
      }
      active_sessions: {
        Row: {
          ended_at: string | null
          id: string
          last_seen_at: string
          metadata: Json
          node_id: string
          request_id: string | null
          requester_id: string | null
          started_at: string
          terminated_at: string | null
          terminated_by: string | null
          termination_reason: string | null
        }
        Insert: {
          ended_at?: string | null
          id?: string
          last_seen_at?: string
          metadata?: Json
          node_id: string
          request_id?: string | null
          requester_id?: string | null
          started_at?: string
          terminated_at?: string | null
          terminated_by?: string | null
          termination_reason?: string | null
        }
        Update: {
          ended_at?: string | null
          id?: string
          last_seen_at?: string
          metadata?: Json
          node_id?: string
          request_id?: string | null
          requester_id?: string | null
          started_at?: string
          terminated_at?: string | null
          terminated_by?: string | null
          termination_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "active_sessions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "desktop_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_sessions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "access_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      desktop_nodes: {
        Row: {
          created_at: string
          failed_attempts: number
          id: string
          last_seen: string | null
          locked_until: string | null
          local_ip: string
          master_password_hash: string | null
          name: string
          os: string
          owner_id: string | null
          password_algo: string | null
          password_updated_at: string | null
          password_version: number
          remote_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          failed_attempts?: number
          id?: string
          last_seen?: string | null
          locked_until?: string | null
          local_ip: string
          master_password_hash?: string | null
          name: string
          os?: string
          owner_id?: string | null
          password_algo?: string | null
          password_updated_at?: string | null
          password_version?: number
          remote_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          failed_attempts?: number
          id?: string
          last_seen?: string | null
          locked_until?: string | null
          local_ip?: string
          master_password_hash?: string | null
          name?: string
          os?: string
          owner_id?: string | null
          password_algo?: string | null
          password_updated_at?: string | null
          password_version?: number
          remote_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
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
      admin_decide_access_request: {
        Args: {
          p_decision: string
          p_note?: string
          p_request_id: string
          p_single_use?: boolean
          p_ttl_minutes?: number
        }
        Returns: {
          decided_at: string | null
          decided_by: string | null
          expires_at: string | null
          id: string
          location_hint: string | null
          node_id: string
          node_name: string | null
          pending_expires_at: string | null
          request_reason: string | null
          requested_at: string
          requester_id: string
          requester_identity: string | null
          revoked_at: string | null
          session_token: string | null
          status_reason_code: string | null
          status_reason_message: string | null
          status: string
          token_bound_node_id: string
          token_bound_requester_id: string
          token_single_use: boolean
          token_used_at: string | null
        }
      }
      admin_terminate_session: {
        Args: {
          p_reason?: string
          p_session_id: string
        }
        Returns: {
          ended_at: string | null
          id: string
          last_seen_at: string
          metadata: Json
          node_id: string
          request_id: string | null
          requester_id: string | null
          started_at: string
          terminated_at: string | null
          terminated_by: string | null
          termination_reason: string | null
        }
      }
      authorize_privileged_access: {
        Args: {
          p_local?: boolean
          p_node_id: string
          p_request_id?: string
          p_requester_id?: string
          p_session_token?: string
        }
        Returns: {
          access_mode: string
          authorized: boolean
          denial_reason: string | null
          matched_request_id: string | null
        }[]
      }
      audit_access_mode_decision: {
        Args: {
          p_detected_same_lan: boolean
          p_detection_source?: string
          p_effective_mode: string
          p_manual_lan_mode: boolean
          p_node_id: string
          p_override_differs?: boolean
          p_requester_hints?: string[]
        }
        Returns: string
      }
      dashboard_nodes_with_lan: {
        Args: {
          p_requester_hints?: string[]
          p_requester_ip?: string
        }
        Returns: {
          id: string
          lan_detection_source: string | null
          last_seen: string | null
          local_ip: string
          name: string
          os: string
          remote_id: string
          same_lan: boolean
          status: string
        }[]
      }
      expire_access_requests: {
        Args: {
          p_pending_timeout_minutes?: number
        }
        Returns: number
      }
      export_incident_review: {
        Args: {
          p_event_type?: string
          p_format?: string
          p_from?: string
          p_to?: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_private_lan_ip: {
        Args: {
          ip_text: string
        }
        Returns: boolean
      }
      lan_ipv4_subnet: {
        Args: {
          ip_text: string
          mask_bits?: number
        }
        Returns: string
      }
      record_privileged_event: {
        Args: {
          p_action: string
          p_local?: boolean
          p_metadata?: Json
          p_node_id: string
          p_request_id?: string
          p_requester_id?: string
          p_session_token?: string
        }
        Returns: {
          authorized: boolean
          denial_reason: string | null
          event_id: string
        }[]
      }
      set_node_master_password: {
        Args: {
          p_node_id: string
          p_password: string
        }
        Returns: {
          error_code: string | null
          password_algo: string | null
          password_updated_at: string | null
          password_version: number | null
          success: boolean
        }[]
      }
      verify_node_master_password: {
        Args: {
          p_context?: string
          p_node_id: string
          p_password: string
        }
        Returns: {
          error_code: string | null
          failed_attempts: number | null
          locked_until: string | null
          password_updated_at: string | null
          password_version: number | null
          verified: boolean
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
