export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      game_progress: {
        Row: {
          completed: number;
          created_at: string;
          destination: Json | null;
          expedition_active: boolean;
          level: number;
          trail: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed?: number;
          created_at?: string;
          destination?: Json | null;
          expedition_active?: boolean;
          level?: number;
          trail?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed?: number;
          created_at?: string;
          destination?: Json | null;
          expedition_active?: boolean;
          level?: number;
          trail?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      hunt_players: {
        Row: {
          completed_at: string | null;
          display_name: string;
          joined_at: string;
          room_id: string;
          status: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          display_name: string;
          joined_at?: string;
          room_id: string;
          status?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          display_name?: string;
          joined_at?: string;
          room_id?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hunt_players_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "hunt_rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      hunt_rooms: {
        Row: {
          code: string;
          created_at: string;
          expires_at: string | null;
          finished_at: string | null;
          host_user_id: string;
          id: string;
          max_players: number;
          mode: string;
          started_at: string | null;
          state: string;
          time_limit_minutes: number | null;
          updated_at: string;
          winner_user_id: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          expires_at?: string | null;
          finished_at?: string | null;
          host_user_id: string;
          id?: string;
          max_players?: number;
          mode: string;
          started_at?: string | null;
          state?: string;
          time_limit_minutes?: number | null;
          updated_at?: string;
          winner_user_id?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          expires_at?: string | null;
          finished_at?: string | null;
          host_user_id?: string;
          id?: string;
          max_players?: number;
          mode?: string;
          started_at?: string | null;
          state?: string;
          time_limit_minutes?: number | null;
          updated_at?: string;
          winner_user_id?: string | null;
        };
        Relationships: [];
      };
      hunt_targets: {
        Row: {
          assigned_at: string;
          completed_at: string | null;
          destination: Json;
          room_id: string;
          user_id: string;
        };
        Insert: {
          assigned_at?: string;
          completed_at?: string | null;
          destination: Json;
          room_id: string;
          user_id: string;
        };
        Update: {
          assigned_at?: string;
          completed_at?: string | null;
          destination?: Json;
          room_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hunt_targets_room_id_user_id_fkey";
            columns: ["room_id", "user_id"];
            isOneToOne: true;
            referencedRelation: "hunt_players";
            referencedColumns: ["room_id", "user_id"];
          },
        ];
      };
      photo_memories: {
        Row: {
          created_at: string;
          id: string;
          lat: number;
          lng: number;
          size_m: number;
          storage_path: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lat: number;
          lng: number;
          size_m?: number;
          storage_path: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lat?: number;
          lng?: number;
          size_m?: number;
          storage_path?: string;
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
      complete_hunt_target: { Args: { p_room_id: string }; Returns: undefined };
      create_hunt_room: {
        Args: { p_display_name: string; p_mode: string };
        Returns: {
          code: string;
          created_at: string;
          expires_at: string | null;
          finished_at: string | null;
          host_user_id: string;
          id: string;
          max_players: number;
          mode: string;
          started_at: string | null;
          state: string;
          time_limit_minutes: number | null;
          updated_at: string;
          winner_user_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "hunt_rooms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      expire_hunt_room: {
        Args: { p_room_id: string };
        Returns: {
          code: string;
          created_at: string;
          expires_at: string | null;
          finished_at: string | null;
          host_user_id: string;
          id: string;
          max_players: number;
          mode: string;
          started_at: string | null;
          state: string;
          time_limit_minutes: number | null;
          updated_at: string;
          winner_user_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "hunt_rooms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      is_hunt_member:
        | { Args: { _room_id: string; _user_id: string }; Returns: boolean }
        | { Args: { p_room_id: string }; Returns: boolean };
      is_hunt_realtime_member: { Args: { p_topic: string }; Returns: boolean };
      join_hunt_room: {
        Args: { p_code: string; p_display_name: string };
        Returns: {
          code: string;
          created_at: string;
          expires_at: string | null;
          finished_at: string | null;
          host_user_id: string;
          id: string;
          max_players: number;
          mode: string;
          started_at: string | null;
          state: string;
          time_limit_minutes: number | null;
          updated_at: string;
          winner_user_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "hunt_rooms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      leave_hunt_room: { Args: { p_room_id: string }; Returns: undefined };
      set_hunt_target: {
        Args: { p_destination: Json; p_room_id: string };
        Returns: undefined;
      };
      start_hunt_room: {
        Args: { p_room_id: string };
        Returns: {
          code: string;
          created_at: string;
          expires_at: string | null;
          finished_at: string | null;
          host_user_id: string;
          id: string;
          max_players: number;
          mode: string;
          started_at: string | null;
          state: string;
          time_limit_minutes: number | null;
          updated_at: string;
          winner_user_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "hunt_rooms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      start_hunt_room_timed: {
        Args: { p_room_id: string; p_time_limit_minutes?: number };
        Returns: {
          code: string;
          created_at: string;
          expires_at: string | null;
          finished_at: string | null;
          host_user_id: string;
          id: string;
          max_players: number;
          mode: string;
          started_at: string | null;
          state: string;
          time_limit_minutes: number | null;
          updated_at: string;
          winner_user_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "hunt_rooms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
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
    Enums: {},
  },
} as const;
