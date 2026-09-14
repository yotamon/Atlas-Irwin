import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { LicensingDatabase } from "@/types/licensing-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["windows", "macos", "linux"]);
const ARCHITECTURES = new Set(["x86_64", "aarch64"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") ?? "";
  const architecture = url.searchParams.get("architecture") ?? "";
  if (!PLATFORMS.has(platform) || !ARCHITECTURES.has(architecture)) {
    return NextResponse.json({ error: "Unsupported model platform or architecture." }, { status: 400 });
  }
  const db = createServiceClient() as unknown as SupabaseClient<LicensingDatabase>;
  const { data, error } = await db
    .from("ensemblis_model_catalog")
    .select("*")
    .eq("platform", platform)
    .eq("architecture", architecture)
    .eq("enabled", true)
    .order("id")
    .order("version");
  if (error) return NextResponse.json({ error: "Could not load the model catalog." }, { status: 500 });
  return NextResponse.json({
    version: "ensemblis.model-catalog.v1",
    models: (data ?? []).map((model) => ({
      id: model.id,
      version: model.version,
      platform: model.platform,
      architecture: model.architecture,
      url: model.url,
      sha256: model.sha256,
      sizeBytes: model.size_bytes,
      requiredCapability: model.required_capability,
      metadata: model.metadata,
    })),
  });
}
