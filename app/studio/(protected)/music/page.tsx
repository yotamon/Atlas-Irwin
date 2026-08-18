import { MusicGenerator } from "@/components/studio/music-generator";
import { PageHeader } from "@/components/studio/ui";
import { miniMaxGenerationCost } from "@/lib/music/atlas-generator";
import { requireStudioAdmin } from "@/lib/auth/studio";

export default async function MusicLabPage() {
  const { supabase } = await requireStudioAdmin();
  const { data: brandRows } = await supabase
    .from("brand_settings")
    .select("section,content")
    .in("section", ["Brand essence", "Music world"]);
  const brandContext = (brandRows ?? [])
    .map((row) => `${row.section}: ${(row.content as { text?: string } | null)?.text ?? ""}`)
    .filter((value) => !value.endsWith(": "))
    .join(" ");
  const miniMaxModel = process.env.MINIMAX_MUSIC_MODEL?.trim() || "music-2.6";
  const providers = [
    {
      id: "minimax" as const,
      name: "MiniMax Music",
      model: miniMaxModel,
      enabled: Boolean(process.env.MINIMAX_API_KEY?.trim()),
      price: miniMaxGenerationCost(miniMaxModel) === 0 ? "Free trial model" : "$0.15 / generation",
      note: "Cheap default. Up to five minutes per generation; set a -free model in the environment when your account has trial access.",
    },
    {
      id: "eleven" as const,
      name: "Eleven Music",
      model: process.env.ELEVENLABS_MUSIC_MODEL?.trim() || "music_v2",
      enabled: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
      price: "$0.15 / minute",
      note: "Higher-control option. Precise duration and a composition-plan flow for vocal tracks.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Music Lab"
        description="Generate Atlas Irwin drafts inside the Studio. The prompt architecture keeps the project DNA, pushes one signature idea per track, and makes provider cost visible before you spend."
      />
      <MusicGenerator providers={providers} brandContext={brandContext} />
    </>
  );
}
