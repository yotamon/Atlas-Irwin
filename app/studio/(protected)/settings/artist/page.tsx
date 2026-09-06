import Link from "next/link";
import { saveArtistOperatingProfileAction } from "@/app/studio/artist-operating-actions";
import { PageHeader, Status } from "@/components/studio/ui";
import { GOAL_LABELS, MARKETING_INVOLVEMENT_LABELS } from "@/lib/artist-operating/domain";
import { loadArtistOperatingContext } from "@/lib/artist-operating/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

const COMFORT_OPTIONS = [
  ["camera", "Talking / camera"], ["live", "Live footage"], ["studio", "Studio footage"],
  ["photos", "Photography"], ["artwork", "Artwork"], ["graphics", "Graphics / visualisers"],
] as const;

function projectTypeLabel(value: string) {
  if (value === "ai_assisted") return "Human artist using AI tools";
  if (value === "hybrid") return "Hybrid music project";
  if (value === "virtual_persona") return "Virtual / AI persona";
  return "Human artist";
}

export default async function ArtistOperatingSettingsPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const context = await loadArtistOperatingContext({ db: supabase, artist });
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const profile = context.profile;

  return (
    <div className="studio-v2-page">
      <PageHeader title="Artist operating profile" description={`Tell Ensemblis how to work for ${artist.artistName}. These choices shape strategy and interruptions; they do not redefine the artist.`} action={<Link className="button" href={href("/studio/settings")}>Back to Settings</Link>} />

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading"><div><span className="section-label">Artist identity</span><h2>{artist.artistName}</h2><p>Music provenance and working policy stay separate.</p></div><Status>{projectTypeLabel(context.artist.projectType)}</Status></div>
        <p className="v2-muted-copy">A human artist never needs to become an “AI artist” to use Ensemblis. AI can stay entirely behind the scenes, and AI music, synthetic voice, likeness or visuals remain off unless the artist policy allows them.</p>
      </section>

      <form action={saveArtistOperatingProfileAction}>
        <input type="hidden" name="currency" value={profile.currency} />
        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Working relationship</span><h2>How should Ensemblis carry the marketing load?</h2></div></div>
          <div className="v2-settings-grid">
            <label><div><strong>Marketing involvement</strong></div><span className="v2-muted-copy">“I just want to make music” means Ensemblis prepares safe work and interrupts only for consequential decisions.</span><select name="marketing_involvement" defaultValue={profile.marketingInvolvement}>{Object.entries(MARKETING_INVOLVEMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label><div><strong>Career stage</strong></div><select name="career_stage" defaultValue={profile.careerStage}><option value="starting">Starting</option><option value="emerging">Emerging</option><option value="active">Active / working artist</option><option value="established">Established</option></select></label>
            <label><div><strong>Main goal right now</strong></div><select name="primary_goal" defaultValue={profile.primaryGoal}>{Object.entries(GOAL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label><div><strong>Artist visibility</strong></div><select name="visibility_mode" defaultValue={profile.visibilityMode}><option value="face_forward">Face-forward</option><option value="selective">Selective</option><option value="music_first">Mostly music and visuals</option><option value="anonymous">Anonymous / no artist face</option></select></label>
            <label><div><strong>Release cadence</strong></div><select name="release_cadence" defaultValue={profile.releaseCadence}><option value="frequent">Frequent</option><option value="steady">Steady</option><option value="occasional">Occasional</option></select></label>
            <label><div><strong>Monthly growth budget</strong></div><span className="v2-muted-copy">Strategic context only. Autonomy contracts still govern paid actions.</span><input type="number" min="0" step="1" name="monthly_budget" defaultValue={profile.monthlyBudgetCents / 100} /></label>
          </div>
        </section>

        <section className="v2-section">
          <input type="hidden" name="content_comfort_present" value="1" />
          <div className="v2-section-heading"><div><span className="section-label">Authentic source material</span><h2>What kinds of real artist media are comfortable?</h2><p>Ensemblis prioritizes source assets before synthetic generation.</p></div></div>
          <div className="v2-settings-grid">{COMFORT_OPTIONS.map(([key, label]) => <label key={key}><div><strong>{label}</strong></div><input type="checkbox" name="content_comfort" value={key} defaultChecked={profile.contentComfort.includes(key)} /></label>)}</div>
        </section>

        <section className="v2-section">
          <input type="hidden" name="scene_profile_present" value="1" />
          <div className="v2-section-heading"><div><span className="section-label">Scene</span><h2>Give Scene Intelligence a grounded starting point</h2><p>These are explicit artist facts. Named labels, playlists, festivals and promoters only appear when Ensemblis has evidence for the relationship.</p></div></div>
          <div className="v2-settings-grid">
            <label><div><strong>Primary scene</strong></div><input type="text" name="primary_scene" maxLength={120} placeholder="e.g. psychedelic trance" defaultValue={context.scene.primaryScene ?? ""} /></label>
            <label><div><strong>Sub-scenes</strong></div><span className="v2-muted-copy">Comma separated.</span><input type="text" name="sub_scenes" defaultValue={context.scene.subScenes.join(", ")} placeholder="progressive psytrance, psychedelic trance" /></label>
            <label><div><strong>Geographic affinities</strong></div><span className="v2-muted-copy">Scenes or markets the artist already identifies with, not inferred demographics.</span><input type="text" name="geographic_affinities" defaultValue={context.scene.geographicAffinities.join(", ")} placeholder="Berlin, Portugal, Brazil" /></label>
          </div>
        </section>

        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">AI policy</span><h2>AI is a capability, not the artist identity</h2></div></div>
          <div className="v2-settings-grid">
            <label><input type="hidden" name="ai_writing_allowed_control" value="1" /><div><strong>Writing assistance</strong></div><span className="v2-muted-copy">Strategy, captions, pitches and drafts.</span><input type="checkbox" name="ai_writing_allowed" defaultChecked={profile.aiPolicy.writingAllowed} /></label>
            <label><input type="hidden" name="ai_visuals_allowed_control" value="1" /><div><strong>Generative visuals</strong></div><span className="v2-muted-copy">Used only after source-first options when appropriate.</span><input type="checkbox" name="ai_visuals_allowed" defaultChecked={profile.aiPolicy.visualsAllowed} /></label>
            <label><input type="hidden" name="ai_music_allowed_control" value="1" /><div><strong>AI music creation</strong></div><span className="v2-muted-copy">Off by default for human projects; keep it off when Ensemblis should only manage existing music.</span><input type="checkbox" name="ai_music_allowed" defaultChecked={profile.aiPolicy.musicAllowed} /></label>
            <label><input type="hidden" name="ai_voice_allowed_control" value="1" /><div><strong>Synthetic voice</strong></div><span className="v2-muted-copy">Off by default.</span><input type="checkbox" name="ai_voice_allowed" defaultChecked={profile.aiPolicy.voiceAllowed} /></label>
            <label><input type="hidden" name="ai_likeness_allowed_control" value="1" /><div><strong>Synthetic artist likeness</strong></div><span className="v2-muted-copy">Off by default. Ensemblis must not fabricate the artist visually without permission.</span><input type="checkbox" name="ai_likeness_allowed" defaultChecked={profile.aiPolicy.likenessAllowed} /></label>
            <label><div><strong>Disclosure preference</strong></div><select name="disclosure_preference" defaultValue={profile.aiPolicy.disclosurePreference}><option value="required_only">Disclose where required</option><option value="always">Prefer explicit AI-assistance disclosure</option></select></label>
          </div>
        </section>

        <div className="actions"><button className="button primary" type="submit">Save artist operating profile</button><Link className="button" href={href("/studio/growth/strategy")}>View artist strategy</Link></div>
      </form>
    </div>
  );
}
