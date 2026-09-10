import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { MomentsDatabase } from "@/types/moments-database";
import type { MomentAwareMarketingDatabase } from "@/types/moment-marketing-database";

export function asMomentsClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<MomentsDatabase>;
}

export function asMomentAwareMarketingClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<MomentAwareMarketingDatabase>;
}
