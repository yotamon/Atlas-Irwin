const PLACEHOLDER_MARKERS = [
  "your-project.supabase.co",
  "your-publishable-or-legacy-anon-key",
  "your-server-only-service-role-or-secret-key",
];

function isPlaceholder(value: string) {
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

export function hasSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  if (isPlaceholder(url) || isPlaceholder(key)) return false;
  return true;
}

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || isPlaceholder(url) || isPlaceholder(key)) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { url, key };
}
