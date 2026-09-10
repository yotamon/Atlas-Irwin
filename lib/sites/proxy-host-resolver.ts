type ProxySiteHost = {
  siteId: string;
  siteSlug: string;
};

type HostRpcRow = {
  site_id?: string;
  site_slug?: string;
};

export function normalizeRequestHostname(input: string) {
  return input.trim().toLowerCase().split(",")[0].replace(/:\d+$/, "").replace(/\.$/, "");
}

export async function resolveSiteHostForProxy(input: string): Promise<ProxySiteHost | null> {
  const hostname = normalizeRequestHostname(input);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || !hostname) return null;

  const response = await fetch(`${url}/rest/v1/rpc/resolve_artist_site_hostname`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target_hostname: hostname }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Site hostname resolution failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json()) as HostRpcRow[];
  const row = rows[0];
  if (!row?.site_id || !row.site_slug) return null;
  return { siteId: row.site_id, siteSlug: row.site_slug };
}
