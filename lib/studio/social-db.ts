import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { SocialDatabase } from "@/types/social-database";

export function asSocialClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<SocialDatabase>;
}
