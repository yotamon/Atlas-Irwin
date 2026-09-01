import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CampaignAiSpendCard } from "@/components/studio/campaign-ai-spend-card";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";

export default async function CampaignWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const { data: campaign, error } = await marketing.from("campaigns")
    .select("id,mode")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!campaign) notFound();

  return (
    <>
      <CampaignAiSpendCard campaignId={campaign.id} campaignMode={campaign.mode} />
      {children}
    </>
  );
}
