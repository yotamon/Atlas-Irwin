import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { vaultAnalysisReadiness } from "@/lib/studio/vault-analysis";

function analysisStatus(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Not analyzed";
  const status = (value as Record<string, unknown>).status;
  return typeof status === "string" ? status.replaceAll("_", " ") : "Not analyzed";
}

export default async function GrowthImportPage() {
  const { supabase, user } = await requireStudioAdmin();
  const growth = asGrowthClient(supabase);
  const { data: recent, error } = await growth.from("track_vault").select("*").eq("owner_id", user.id).neq("status", "archived").order("created_at", { ascending: false }).limit(8);
  if (error) throw new Error(error.message);
  const worker = vaultAnalysisReadiness();

  return <div className="studio-v2-page growth-import-page">
    <PageHeader title="Import unreleased masters" description="Drop the backlog in one pass. Each audio file becomes a reusable Media Library asset and an independent Vault track; free worker analysis starts automatically when configured." action={<Link className="button" href="/studio/growth#vault">Back to Vault</Link>} />

    <section className="v2-section">
      <div className="v2-section-heading"><div><span className="section-label">Bulk intake</span><h2>Get the music into the system first</h2></div><span className={`v2-dot ${worker.configured ? "connected" : ""}`} aria-hidden /></div>
      <p className="v2-muted-copy">Do not create releases yet. Upload masters, let Atlas extract structural signals, then rate only the subjective things the computer cannot know, such as how much you personally believe in the track and how distinctive it feels in the Atlas Irwin catalog.</p>
      {!worker.configured ? <div className="notice">Media Worker is not configured in this environment. Uploads still enter the Vault safely; analysis is marked unavailable instead of pretending it ran.</div> : null}
      <MediaUploader defaultRole="master_audio" vaultMode />
    </section>

    <section className="v2-section">
      <div className="v2-section-heading"><div><span className="section-label">Recent intake</span><h2>Latest Vault tracks</h2></div><Link href="/studio/growth#vault">Rank all tracks</Link></div>
      {recent?.length ? <div className="growth-vault-list">{recent.map((track) => <Link className="growth-import-row" href="/studio/growth#vault" key={track.id}><div><strong>{track.title}</strong><small>{track.status.replaceAll("_", " ")} · {analysisStatus(track.analysis)}</small></div><div><span>Hook {track.hook_strength}</span><span>Short-form {track.short_form_potential}</span><span>Ready {track.release_readiness}</span></div></Link>)}</div> : <div className="v2-calm-state compact"><strong>No unreleased masters yet.</strong><p>This is the clean starting point: upload the backlog instead of manually creating releases.</p></div>}
    </section>
  </div>;
}
