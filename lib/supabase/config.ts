const PLACEHOLDER_MARKERS = [
  "your-project.supabase.co",
  "your-publishable-or-legacy-anon-key",
  "your-server-only-service-role-or-secret-key",
];

// Atlas Irwin is a single-project application. Supabase publishable keys are
// intentionally safe to ship to browsers when RLS is enforced. Keeping a
// production-mode fallback here prevents Vercel Preview deployments from
// crashing when NEXT_PUBLIC_* variables were scoped to Production only.
// Server-only service-role / secret keys must never be added here.
const ATLAS_PUBLIC_SUPABASE_URL =
  "https://zhyjnpajlvwwbvuryeyv.supabase.co";
const ATLAS_PUBLIC_SUPABASE_KEY =
  "sb_publishable_PEQ4IDhpFiFrk2f-_qZ4uA_rfm-C4Ae";

function isPlaceholder(value: string) {
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

function publicSupabaseConfig() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const configuredKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  const url =
    configuredUrl && !isPlaceholder(configuredUrl)
      ? configuredUrl
      : process.env.NODE_ENV === "production"
        ? ATLAS_PUBLIC_SUPABASE_URL
        : undefined;
  const key =
    configuredKey && !isPlaceholder(configuredKey)
      ? configuredKey
      : process.env.NODE_ENV === "production"
        ? ATLAS_PUBLIC_SUPABASE_KEY
        : undefined;

  return { url, key };
}

export function hasSupabaseEnv() {
  const { url, key } = publicSupabaseConfig();
  return Boolean(url && key);
}

export function getSupabaseEnv() {
  const { url, key } = publicSupabaseConfig();
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { url, key };
}
