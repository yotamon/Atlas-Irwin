import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approveIntelligentVariant,
  refreshCampaignIntelligence,
  rejectIntelligentVariant,
} from "@/app/studio/marketing-intelligence-actions";
import styles from "@/components/studio/marketing-intelligence.module.css";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { MARKETING_REJECTION_REASONS } from "@/lib/marketing/marketing-intelligence-rejection-reasons";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asMomentAwareMarketingClient } from "@/lib/studio/moments-db";
import type { Json } from "@/types/database";

function objectValue(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function stringValue(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: Json | undefined) {
  return typeof value === "number" ? value : 0;
}

function arrayValue(value: Json | undefined) {
  return Array.isArray(value) ? value : [];
}

function stringList(value: Json | undefined) {
  return arrayValue(value).filter((entry): entry is string => typeof entry === "string");
}

function objectList(value: Json | undefined) {
  return arrayValue(value).filter((entry): entry is Record<string, Json | undefined> =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
  );
}

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function archetypeLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function qualityEvidence(publishability: Record<string, Json | undefined>) {
  const specificity = numberValue(publishability.specificityScore);
  const duplicateRisk = numberValue(publishability.duplicateRisk);
  const reasons = stringList(publishability.reasons)
    .filter((reason) => !/\d+\/100 artist\/release specificity/i.test(reason))
    .filter((reason) => !/\d+% semantic novelty/i.test(reason));
  const specificityLabel = specificity >= 65
    ? "Strong artist and release specificity"
    : specificity >= 48
      ? "Clear artist or release specificity"
      : "Specificity is present but should be reviewed";
  const noveltyLabel = duplicateRisk <= 0.2
    ? "Clearly distinct from recent artist content"
    : duplicateRisk <= 0.45
      ? "Reasonably distinct from recent artist content"
      : "Some creative similarity to recent artist content";
  return [specificityLabel, noveltyLabel, ...reasons];
}

export default async function CampaignIntelligencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const marketing = asMarketingClient(supabase);
  const momentMarketing = asMomentAwareMarketingClient(supabase);

  const { data: campaign, error: campaignError } = await marketing.from("campaigns")
    .select("*")
    .eq("id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle();
  if (campaignError) throw new Error(campaignError.message);
  if (!campaign) notFound();

  const [contentResult, variantResult] = await Promise.all([
    momentMarketing.from("content_items").select("*")
      .eq("campaign_id", campaign.id).eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .order("scheduled_at", { ascending: true }),
    marketing.from("content_variants").select("*")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at", { ascending: true }),
  ]);
  if (contentResult.error) throw new Error(contentResult.error.message);
  if (variantResult.error) throw new Error(variantResult.error.message);

  const content = contentResult.data ?? [];
  const contentIds = new Set(content.map((item) => item.id));
  const variants = (variantResult.data ?? []).filter((variant) => contentIds.has(variant.content_item_id));
  const strategy = objectValue(campaign.strategy);
  const hasIntelligence = stringValue(strategy.planVersion) === "marketing-intelligence-v2";
  const dna = objectValue(strategy.artistMarketingDna);
  const selectedMoments = objectList(strategy.selectedMusicMoments);
  const funnel = objectList(strategy.funnelStrategy);
  const directors = objectList(strategy.platformDirectors);
  const cards = objectList(strategy.productionCards);
  const normalizedPerformance = objectList(strategy.normalizedPerformance);
  const quality = objectValue(strategy.qualitySummary);
  const rejectionSignals = stringList(strategy.rejectionSignals);
  const contentPillars = stringList(strategy.contentPillars);
  const secondaryArchetypes = stringList(dna.secondaryArchetypes);
  const artistInput = <input type="hidden" name="artist_id" value={artist.artistId} />;

  return (
    <div className={styles.shell}>
      <PageHeader
        title="Campaign Intelligence"
        description={`Ensemblis decides what is actually worth publishing for ${artist.artistName}, then explains the music, audience, platform and quality evidence behind each choice.`}
        action={<Link className="button" href={`/studio/campaigns/${campaign.id}`}>Campaign workspace</Link>}
      />

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Artist-first marketing system</span>
          <h1>Fewer ideas. Better reasons.</h1>
          <p>Ensemblis ranks the campaign against Artist Marketing DNA, approved musical Moments, platform-native behavior, previous creative and this artist&apos;s own performance baseline. It never fills a content quota with generic posts.</p>
        </div>
        <form action={refreshCampaignIntelligence}>
          {artistInput}
          <input type="hidden" name="campaign_id" value={campaign.id} />
          <button className="button primary" type="submit">{hasIntelligence ? "Rebuild intelligent campaign" : "Build intelligent campaign"}</button>
        </form>
      </section>

      {!hasIntelligence ? (
        <section className={styles.empty}>
          <span className={styles.eyebrow}>No v2 intelligence yet</span>
          <h2>Build the decision layer before producing more media.</h2>
          <p>The run is explicit and does not spend on image or video generation. If no approved full musical Moment is available, Ensemblis stops instead of inventing an arbitrary cut.</p>
        </section>
      ) : (
        <>
          <div className={styles.stats}>
            <article><span>Ideas worth developing</span><strong>{numberValue(quality.selected)}</strong><small>kept from {numberValue(quality.candidatesEvaluated)} candidates after specificity, novelty, music and platform checks</small></article>
            <article><span>Strong reusable Moments</span><strong>{selectedMoments.length}</strong><small>approved, ranked and overlap-controlled</small></article>
            <article><span>Artist-normalized analytics</span><strong>{normalizedPerformance.filter((row) => stringValue(row.relativeLabel) === "breakout").length}</strong><small>breakout observations versus this artist&apos;s own baseline</small></article>
            <article><span>Learned rejections</span><strong>{rejectionSignals.length}</strong><small>negative signals future planning must avoid</small></article>
          </div>

          <section className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Artist Marketing DNA</span><h2>{archetypeLabel(stringValue(dna.primaryArchetype)) || "Artist-specific operating model"}</h2></div><span className={styles.score}>{stringValue(dna.evidenceStrength) || "low"} evidence</span></div>
            <p className={styles.lead}>{stringValue(dna.audiencePromise)}</p>
            {secondaryArchetypes.length ? <div className={styles.tags}>{secondaryArchetypes.map((archetype) => <span key={archetype}>Also {archetypeLabel(archetype)}</span>)}</div> : null}
            <div className={styles.columns}>
              <div><h3>Signature signals</h3><div className={styles.tags}>{stringList(dna.signatureSignals).map((signal) => <span key={signal}>{signal}</span>)}</div></div>
              <div><h3>Voice principles</h3><ul>{stringList(dna.voicePrinciples).map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h3>Hard anti-patterns</h3><ul>{stringList(dna.antiPatterns).slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul></div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Dynamic content pillars</span><h2>Only the pillars that fit this artist and campaign</h2></div><p>The mix changes with the objective, artist archetypes, release evidence and Creative Memory.</p></div>
            <div className={styles.tags}>{contentPillars.map((pillar) => <span key={pillar}>{pillar}</span>)}</div>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Strongest reusable Moments</span><h2>Music before content</h2></div><p>Full boundaries are preserved. No arbitrary 10-second trim.</p></div>
            <div className={styles.momentGrid}>
              {selectedMoments.map((moment, index) => {
                const start = numberValue(moment.startMs) / 1000;
                const end = numberValue(moment.endMs) / 1000;
                return <article key={stringValue(moment.id) || index}>
                  <span>#{index + 1} · {stringValue(moment.sourceMode)}</span>
                  <h3>{stringValue(moment.label)}</h3>
                  <strong>{formatSeconds(start)} → {formatSeconds(end)}</strong>
                  <small>{stringList(moment.selectionReasons).join(" · ")}</small>
                </article>;
              })}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Funnel strategy</span><h2>Discovery to superfan</h2></div><p>Every piece has one job. Reach is not the end state.</p></div>
            <div className={styles.funnel}>
              {funnel.map((stage, index) => <article key={`${stringValue(stage.stage)}-${index}`}><span>{index + 1}</span><div><strong>{stringValue(stage.stage)}</strong><small>{stringValue(stage.job)}</small></div></article>)}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Not cross-posting</span><h2>Platform Directors</h2></div><p>One campaign world, different native executions.</p></div>
            <div className={styles.directorGrid}>
              {directors.map((director) => <article key={stringValue(director.platform)}><span>{stringValue(director.platform)}</span><h3>{stringValue(director.role)}</h3><p>{stringValue(director.opening)}</p><small>Formats: {stringList(director.formats).join(" · ")}</small><small>Avoid: {stringList(director.avoid).join(" · ")}</small></article>)}
            </div>
          </section>

          <section>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Production cards</span><h2>The strongest candidates worth developing</h2></div><p>Every card includes the exact music window, shot list, assets and explainable quality evidence.</p></div>
            <div className={styles.cardList}>
              {cards.map((card, index) => {
                const item = content.find((candidate) => candidate.title === stringValue(card.contentTitle) && candidate.platform === stringValue(card.platform));
                const itemVariants = item ? variants.filter((variant) => variant.content_item_id === item.id) : [];
                const publishability = objectValue(card.publishability);
                const start = numberValue(card.audioStartSeconds);
                const end = numberValue(card.audioEndSeconds);
                return <article className={styles.productionCard} key={stringValue(card.id) || index}>
                  <div className={styles.cardTop}>
                    <div><span className={styles.eyebrow}>{stringValue(card.platform)} · {stringValue(card.format)} · {stringValue(card.funnelStage)}</span><h2>{stringValue(card.contentTitle)}</h2><p>{stringValue(card.concept)}</p></div>
                    <div className={styles.publishability}><strong>{stringValue(publishability.decision) === "publishable" ? "Strong" : "Review"}</strong><span>quality evidence</span></div>
                  </div>
                  <div className={styles.cardGrid}>
                    <div><h3>Opening</h3><p>{stringValue(card.opening)}</p><h3>Audience</h3><p>{stringValue(card.audience)}</p><h3>KPI</h3><p>{stringValue(card.primaryKpi)}</p></div>
                    <div><h3>Music</h3><p>{stringValue(card.musicMomentLabel) || "No Moment"}</p>{end > start ? <strong>{formatSeconds(start)} → {formatSeconds(end)}</strong> : null}<small>{stringValue(card.audioIntegrityRule)}</small><h3>Edit rhythm</h3><p>{stringValue(card.editRhythm)}</p></div>
                    <div><h3>Shot list</h3><ol>{stringList(card.shotList).map((shot) => <li key={shot}>{shot}</li>)}</ol></div>
                    <div><h3>Assets</h3><ul>{stringList(card.assetChecklist).map((asset) => <li key={asset}>{asset}</li>)}</ul><h3>Source plan</h3><p>{stringValue(card.sourcePlan)}</p></div>
                  </div>
                  <div className={styles.qualityReasons}>{qualityEvidence(publishability).map((reason) => <span key={reason}>{reason}</span>)}</div>
                  {itemVariants.length ? <div className={styles.variantList}>{itemVariants.map((variant) => <article key={variant.id}>
                    <div><span>Variant {variant.label} · {variant.approval_status}</span><strong>{variant.hook_text}</strong><p>{variant.caption}</p></div>
                    {variant.approval_status === "pending" ? <div className={styles.feedbackActions}>
                      <form action={approveIntelligentVariant}>{artistInput}<input type="hidden" name="campaign_id" value={campaign.id} /><input type="hidden" name="variant_id" value={variant.id} /><button className="button primary" type="submit">Approve + teach Ensemblis</button></form>
                      <details><summary className="button">Reject + teach Ensemblis</summary><form action={rejectIntelligentVariant} className={styles.rejectForm}>{artistInput}<input type="hidden" name="campaign_id" value={campaign.id} /><input type="hidden" name="variant_id" value={variant.id} /><label><span>Why?</span><select name="reason" defaultValue="not_me">{MARKETING_REJECTION_REASONS.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}</select></label><label><span>Optional note</span><textarea name="notes" maxLength={500} rows={3} placeholder="What specifically should Ensemblis learn?" /></label><button className="button" type="submit">Reject and remember</button></form></details>
                    </div> : null}
                  </article>)}</div> : null}
                </article>;
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
