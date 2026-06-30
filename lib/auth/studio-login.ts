import { timingSafeEqual } from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/types/database";
import { adminEmails, isStudioAdmin } from "./studio";

function safeEqual(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function studioPassword() {
  return process.env.STUDIO_PASSWORD?.trim() ?? "";
}

function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error("Studio login is not configured.");
  }
  const { url } = getSupabaseEnv();
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function ensureAuthUser(admin: SupabaseClient<Database>, email: string) {
  const generated = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (!generated.error) return generated;

  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.error) throw new Error(created.error.message);

  const retry = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (retry.error) throw new Error(retry.error.message);
  return retry;
}

export async function signInStudioAdmin(
  supabase: SupabaseClient<Database>,
  emailInput: string | undefined,
  password: string,
) {
  const expected = studioPassword();
  if (!expected) throw new Error("Studio password login is not configured.");
  if (!safeEqual(password, expected)) throw new Error("Invalid password.");

  const email = (emailInput?.trim().toLowerCase() || adminEmails()[0] || "").trim();
  if (!email) throw new Error("No Studio admin email is configured.");
  if (!isStudioAdmin(email)) throw new Error("Access denied.");

  const admin = createAdminClient();
  const result = await ensureAuthUser(admin, email);
  const link = result.data;
  if (!link) throw new Error("Unable to start Studio session.");

  const tokenHash = link.properties.hashed_token;
  if (!tokenHash) throw new Error("Unable to start Studio session.");

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });
  if (verifyError) throw new Error(verifyError.message);
}
