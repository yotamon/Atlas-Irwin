import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CampaignAiSpendCard } from "@/components/studio/campaign-ai-spend-card";
import { createClient } from "@/lib/supabase/server";
import { asMarketingClient } from "@/lib/marketing/db";
import { requireArtistContext } from "@/lib/studio/artist-context";

export default async function CampaignWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artist = await requireArtistContext();
  const supabase = await createClient();
  const marketing = asMarketingClient(supabase);
  const { data: campaign, error } = await marketing.from("campaigns")
    .select("id,mode")
    .eq("id", id)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!campaign) notFound();

  return (
    <>
      <nav className="actions" aria-label="Campaign workspace views">
        <Link className="button" href={`/studio/campaigns/${campaign.id}`}>Execution</Link>
        <Link className="button" href={`/studio/campaigns/${campaign.id}/intelligence`}>Campaign Intelligence</Link>
      </nav>
      <CampaignAiSpendCard campaignId={campaign.id} campaignMode={campaign.mode} />
      {children}
    </>
  );
}
