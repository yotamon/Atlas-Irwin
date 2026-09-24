import Link from "next/link";
import { Status } from "@/components/studio/ui";

export function ReleaseCampaignBridge({
  campaign,
}: {
  campaign: {
    id: string;
    name: string;
    status: string;
    mode: string;
    objective: string;
    primary_kpi: string;
  } | null;
}) {
  return (
    <section className="workspace-section">
      <div className="section-head">
        <div>
          <span className="section-label">Campaign</span>
          <h2>{campaign ? "First-class marketing system connected" : "Prepare a campaign for this release"}</h2>
        </div>
        {campaign ? <Status>{campaign.status}</Status> : null}
      </div>
      {campaign ? (
        <>
          <p>{campaign.name} uses {campaign.objective} as its primary job, tracks {campaign.primary_kpi}, and runs in {campaign.mode} mode. Strategy, experiments, variants, attribution, automation and approved learnings live in the campaign workspace.</p>
          <div className="actions">
            <Link className="button primary" href={`/studio/campaigns/${campaign.id}`}>Open campaign</Link>
            <Link className="button" href="/studio/outreach">Open outreach</Link>
          </div>
        </>
      ) : (
        <>
          <p>The legacy campaign tab below remains available for existing content records, but new intelligent planning should start in the campaign workspace so the release gets phases, experiments, attribution and a learning loop.</p>
          <Link className="button primary" href="/studio/campaigns#new">Create first-class campaign</Link>
        </>
      )}
    </section>
  );
}
