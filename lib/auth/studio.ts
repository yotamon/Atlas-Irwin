import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/types/database";
import {
  isLocalStudioBypassHost,
  LOCAL_STUDIO_EMAIL,
  LOCAL_STUDIO_USER_ID,
} from "./local-studio";

type StudioUser = Pick<User, "email" | "id">;
type StudioAuthContext = {
  supabase: SupabaseClient<Database>;
  user: StudioUser;
};

export function adminEmails() {
  return (process.env.STUDIO_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isStudioAdmin(email?: string | null) {
  return Boolean(email && adminEmails().includes(email.toLowerCase()));
}

function forwardedValue(h: Headers, headerName: string) {
  return h.get(headerName)?.split(",")[0]?.trim();
}

async function requestHost() {
  const h = await headers();
  return forwardedValue(h, "x-forwarded-host") || h.get("host") || undefined;
}

function createLocalStudioClient() {
  const { url, key } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  return createSupabaseClient<Database>(url, serviceRoleKey || key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function requireLocalStudioAdmin(): Promise<StudioAuthContext> {
  const supabase = createLocalStudioClient();
  const preferredEmail = adminEmails()[0] ?? LOCAL_STUDIO_EMAIL;
  const { data: preferredProfile } = await supabase
    .from("profiles")
    .select("id,email")
    .eq("email", preferredEmail)
    .maybeSingle();

  if (preferredProfile) {
    return {
      supabase,
      user: { id: preferredProfile.id, email: preferredProfile.email },
    };
  }

  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("id,email")
    .eq("is_admin", true)
    .limit(1)
    .maybeSingle();

  return {
    supabase,
    user: {
      id: adminProfile?.id ?? LOCAL_STUDIO_USER_ID,
      email: adminProfile?.email ?? preferredEmail,
    },
  };
}

export async function requireStudioAdmin(): Promise<StudioAuthContext> {
  if (isLocalStudioBypassHost(await requestHost())) {
    return requireLocalStudioAdmin();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/studio/login");
  if (!isStudioAdmin(data.user.email)) redirect("/studio/access-denied");
  return { supabase, user: data.user };
}
