import "server-only";

import { createMarketingServiceClient } from "./db";
import { createApprovedMasterDerivatives } from "./creative-derivatives";
import type { Json } from "@/types/database";

function record(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function processApprovedCreativeDerivativeEvents(limit = 50) {
  const client = createMarketingServiceClient();
  const { data: events, error } = await client.from("marketing_events")
    .select("*")
    .eq("event_type", "content.ai_asset_approved")
    .is("processed_at", null)
    .order("occurred_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(error.message);

  let processed = 0;
  let derivativesCreated = 0;
  for (const event of events ?? []) {
    if (!event.entity_id) {
      const { error: markError } = await client.from("marketing_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", event.id)
        .eq("owner_id", event.owner_id)
        .eq("artist_id", event.artist_id)
        .is("processed_at", null);
      if (markError) throw new Error(markError.message);
      processed += 1;
      continue;
    }
    const payload = record(event.payload);
    const generationRunId = typeof payload.generationRunId === "string" ? payload.generationRunId : null;
    const result = await createApprovedMasterDerivatives({
      ownerId: event.owner_id,
      artistId: event.artist_id,
      contentItemId: event.entity_id,
      generationRunId,
    });
    const { error: markError } = await client.from("marketing_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id)
      .eq("owner_id", event.owner_id)
      .eq("artist_id", event.artist_id)
      .is("processed_at", null);
    if (markError) throw new Error(markError.message);
    processed += 1;
    derivativesCreated += result.created;
  }
  return { considered: events?.length ?? 0, processed, derivativesCreated };
}
