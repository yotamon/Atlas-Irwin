"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { adminEmails } from "@/lib/auth/studio";
import { signInStudioAdmin } from "@/lib/auth/studio-login";
import { createClient } from "@/lib/supabase/server";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function trySupabasePassword(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  password: string,
) {
  if (!email) return false;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) return false;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || !profile?.is_admin) {
    await supabase.auth.signOut();
    return false;
  }

  return true;
}

export async function signInStudio(form: FormData) {
  const password = z.string().min(1).parse(value(form, "password"));
  const submittedEmail = value(form, "email").toLowerCase();
  const email = submittedEmail || adminEmails()[0] || "";

  let signedIn = false;
  let failureMessage = "Unable to sign in with those credentials.";

  try {
    const supabase = await createClient();

    // Prefer normal Supabase Auth. It works in previews without any privileged
    // server key and authorization remains enforced by the profile RLS policy.
    signedIn = await trySupabasePassword(supabase, email, password);

    // Preserve the existing Studio-password flow for environments where its
    // server-only credentials are configured.
    if (!signedIn) {
      try {
        await signInStudioAdmin(supabase, email || undefined, password);
        signedIn = true;
      } catch (error) {
        if (!email) {
          failureMessage = "Enter your Studio administrator email.";
        } else if (error instanceof Error && error.message === "Access denied.") {
          failureMessage = "This account is not an approved Studio administrator.";
        }
      }
    }
  } catch (error) {
    failureMessage =
      error instanceof Error && error.message.includes("Supabase is not configured")
        ? "Studio authentication is temporarily unavailable."
        : "Unable to complete Studio sign-in.";
  }

  if (!signedIn) {
    redirect(`/studio/login?error=${encodeURIComponent(failureMessage)}`);
  }

  redirect("/studio");
}
