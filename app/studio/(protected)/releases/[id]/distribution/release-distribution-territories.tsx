import type { SupabaseClient } from "@supabase/supabase-js";
import { saveDistributionTerritories } from "@/app/studio/distribution-territory-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import type { Json } from "@/types/database";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default async function ReleaseDistributionTerritories({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as Db;
  const { data: config, error } = await db.from("release_distribution_configs")
    .select("state,territories")
    .eq("release_id", id)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const raw = object(config?.territories);
  const countries = Array.isArray(raw.countries) ? raw.countries.map(String).filter(Boolean) : [];
  const mode = raw.mode === "include" && countries.length ? "include" : "worldwide";
  const locked = Boolean(config && !["draft", "needs_attention", "ready", "rejected", "error"].includes(config.state));

  return <section className="distribution-section">
    <div className="distribution-section-heading">
      <div>
        <span className="section-label">Delivery territory</span>
        <h2>Where this release may be delivered</h2>
        <p>Worldwide is the default. Limit countries only when the release rights actually require it; this becomes part of the immutable submission evidence.</p>
      </div>
      {locked ? <span className="distribution-lock">Locked after submission</span> : null}
    </div>
    <form action={saveDistributionTerritories} className="distribution-form">
      <input type="hidden" name="artist_id" value={artist.artistId} />
      <input type="hidden" name="release_id" value={id} />
      <fieldset disabled={locked}>
        <div className="distribution-radio-row">
          <label><input type="radio" name="territory_mode" value="worldwide" defaultChecked={mode === "worldwide"} />Worldwide <small>Recommended when your rights are worldwide.</small></label>
          <label><input type="radio" name="territory_mode" value="include" defaultChecked={mode === "include"} />Selected countries only</label>
        </div>
        <label>Two-letter country codes<input name="territory_codes" defaultValue={countries.join(", ")} placeholder="DE, AT, CH" /></label>
      </fieldset>
      {!locked ? <div className="actions"><button className="button" type="submit">Save territories</button><span className="distribution-muted">Changing territories invalidates the previous provider preflight.</span></div> : null}
    </form>
  </section>;
}
