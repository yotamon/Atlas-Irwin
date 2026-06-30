import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/types/database";
import { syncPublicReleaseCatalog } from "@/lib/studio/public-catalog";
import { isLocalStudioBypassHost, LOCAL_STUDIO_EMAIL } from "./local-studio";

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
    await syncPublicReleaseCatalog(supabase, preferredProfile.id);
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

  if (adminProfile) {
    await syncPublicReleaseCatalog(supabase, adminProfile.id);
    return {
      supabase,
      user: { id: adminProfile.id, email: adminProfile.email },
    };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error(
      "Local Studio access requires SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  let generated = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: preferredEmail,
  });
  if (generated.error) {
    const created = await supabase.auth.admin.createUser({
      email: preferredEmail,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    generated = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: preferredEmail,
    });
  }
  const localUser = generated.data.user;
  if (!localUser)
    throw new Error("Unable to create the local Studio administrator.");
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      { id: localUser.id, email: preferredEmail, is_admin: true },
      { onConflict: "id" },
    );
  if (profileError) throw new Error(profileError.message);
  await syncPublicReleaseCatalog(supabase, localUser.id);
  return { supabase, user: { id: localUser.id, email: preferredEmail } };
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
