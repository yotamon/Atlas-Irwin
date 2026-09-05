import Link from "next/link";
import { PageHeader, Status } from "@/components/studio/ui";
import { saveAutonomyContract } from "@/app/studio/autonomy-contract-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  AUTONOMY_DOMAINS,
  AUTONOMY_DOMAIN_META,
  type AutonomyContract,
  type AutonomyDomain,
} from "@/lib/autonomy/domain";
import { loadArtistAutonomyContracts } from "@/lib/autonomy/server";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

const GROUPS: Array<{ label: string; domains: AutonomyDomain[] }> = [
  {
    label: "Understand & prepare",
    domains: ["analytics_reconciliation", "music_analysis", "moment_curation", "creative_ideation"],
  },
  {
    label: "Create & grow",
    domains: ["creative_generation", "paid_growth"],
  },
  {
    label: "External actions",
    domains: ["social_scheduling", "social_publishing", "audience_replies", "outreach", "sites", "distribution"],
  },
];

function modeLabel(mode: string) {
  if (mode === "run") return "Run";
  if (mode === "prepare") return "Prepare";
  return "Assist";
}

function dateInput(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function ContractCard({
  domain,
  contract,
}: {
  domain: AutonomyDomain;
  contract: AutonomyContract | null;
}) {
  const meta = AUTONOMY_DOMAIN_META[domain];
  const selectedMode = contract?.mode ?? meta.defaultMode;
  const configured = Boolean(contract?.enabled);
  const expired = Boolean(contract?.expiresAt && Date.parse(contract.expiresAt) <= Date.now());

  return (
    <article className="v2-section v2-compact-section" id={domain}>
      <form action={saveAutonomyContract}>
        <input type="hidden" name="domain" value={domain} />
        <div className="v2-section-heading compact">
          <div>
            <span className="section-label">{domain.replaceAll("_", " ")}</span>
            <h2>{meta.label}</h2>
            <p>{meta.description}</p>
          </div>
          <Status>{expired ? "Expired · safe default" : configured ? `${modeLabel(selectedMode)} contract` : `${modeLabel(meta.defaultMode)} default`}</Status>
        </div>

        <div className="v2-settings-grid">
          <label>
            <div><strong>How independently should Ensemblis work?</strong></div>
            <select name="mode" defaultValue={selectedMode}>
              <option value="assist">Assist · recommend, ask before acting</option>
              <option value="prepare">Prepare · finish safe internal work, ask before external effects</option>
              <option value="run">Run · execute explicitly allowed work inside these rules</option>
            </select>
          </label>
          <label>
            <div><strong>Contract active</strong></div>
            <span className="v2-muted-copy">Disable this override to fall back to Ensemblis&apos;s conservative domain default.</span>
            <input type="checkbox" name="enabled" defaultChecked={contract ? contract.enabled : true} />
          </label>
        </div>

        {(domain === "creative_generation" || domain === "paid_growth") ? (
          <div className="v2-settings-grid">
            <label>
              <div><strong>Per-action spend ceiling</strong></div>
              <span className="v2-muted-copy">Required before a paid action can ever resolve to Run.</span>
              <input
                type="number"
                name="max_single_spend_usd"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="No autonomous paid spend"
                defaultValue={contract?.maxSingleSpendUsd ?? ""}
              />
            </label>
            <label>
              <div><strong>Total contract ceiling</strong></div>
              <span className="v2-muted-copy">An additional ceiling. Existing campaign hard limits still apply.</span>
              <input
                type="number"
                name="max_total_spend_usd"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="Optional"
                defaultValue={contract?.maxTotalSpendUsd ?? ""}
              />
            </label>
          </div>
        ) : null}

        <div className="v2-settings-grid">
          <label>
            <div><strong>Expires</strong></div>
            <span className="v2-muted-copy">Optional. Expired contracts immediately fall back to the safe default.</span>
            <input type="date" name="expires_at" defaultValue={dateInput(contract?.expiresAt)} />
          </label>
        </div>

        <details className="studio-advanced-details">
          <summary>Advanced restrictions</summary>
          <div className="v2-settings-grid">
            <label>
              <div><strong>Allowed platforms</strong></div>
              <span className="v2-muted-copy">Optional comma-separated allow-list. Empty means no extra platform restriction.</span>
              <input
                type="text"
                name="allowed_platforms"
                placeholder="instagram, tiktok"
                defaultValue={contract?.allowedPlatforms.join(", ") ?? ""}
              />
            </label>
            <label>
              <div><strong>Allowed providers</strong></div>
              <span className="v2-muted-copy">Optional technical restriction for execution routing.</span>
              <input
                type="text"
                name="allowed_providers"
                placeholder="Leave empty unless you need a provider restriction"
                defaultValue={contract?.allowedProviders.join(", ") ?? ""}
              />
            </label>
          </div>
        </details>

        <div className="actions">
          <button className="button primary" type="submit">Save autonomy contract</button>
        </div>
      </form>
    </article>
  );
}

export default async function AutonomySettingsPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const contracts = await loadArtistAutonomyContracts({
    db: supabase,
    ownerId: user.id,
    artistId: artist.artistId,
  });
  const byDomain = new Map(contracts.map((contract) => [contract.domain, contract]));
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Autonomy"
        description={`Choose how independently Ensemblis may work for ${artist.artistName}. These rules can grant bounded authority, but they never weaken hard safety gates.`}
        action={<Link className="button" href={href("/studio/settings")}>Back to Settings</Link>}
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Behavior model</span>
            <h2>Assist, Prepare, or Run</h2>
            <p>Autonomy is explicit per domain so analysis can stay automatic while publishing, spend and sensitive communication remain tightly controlled.</p>
          </div>
        </div>
        <div className="v2-settings-grid">
          <article><div><strong>Assist</strong></div><p>Recommend the next action and wait for you before doing it.</p></article>
          <article><div><strong>Prepare</strong></div><p>Complete safe internal work, but stop before external effects or spend.</p></article>
          <article><div><strong>Run</strong></div><p>Execute bounded work only when an active contract and every existing safety gate allow it.</p></article>
        </div>
      </section>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Hard boundaries</span>
            <h2>Some decisions always come back to you</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          Distribution submission, legal or rights declarations, sensitive communication, destructive or irreversible actions always require explicit confirmation in autonomy v1. Paid Run behavior additionally requires a per-action spend ceiling, and existing campaign/generation hard limits remain authoritative.
        </p>
      </section>

      {GROUPS.map((group) => (
        <section className="v2-section" key={group.label}>
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Autonomy domains</span>
              <h2>{group.label}</h2>
            </div>
          </div>
          <div className="v2-learning-list">
            {group.domains.map((domain) => (
              <ContractCard key={domain} domain={domain} contract={byDomain.get(domain) ?? null} />
            ))}
          </div>
        </section>
      ))}

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading"><div><span className="section-label">Auditability</span><h2>Every execution boundary can explain its authority</h2></div></div>
        <p className="v2-muted-copy">The resolver returns Run, Prepare or Ask deterministically and can persist the exact contract and effect snapshot used for that decision. This audit trail is append-only and artist-scoped.</p>
      </section>
    </div>
  );
}
