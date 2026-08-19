import Link from "next/link";
import { notFound } from "next/navigation";
import { disconnectSocialConnection } from "@/app/studio/social-actions";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  SOCIAL_PLATFORM_DEFINITIONS,
  isSocialPlatformKey,
} from "@/lib/marketing/social-platforms";
import { asSocialClient } from "@/lib/studio/social-db";
import { hasSocialPlatformEnv } from "@/lib/studio/social-connections";

export default async function SocialConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { platform } = await params;
  if (!isSocialPlatformKey(platform)) notFound();
  const query = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const social = asSocialClient(supabase);
  const { data: account, error } = await social
    .from("social_channel_accounts")
    .select("*")
    .eq("owner_id", user.id)
    .eq("platform", platform)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const definition = SOCIAL_PLATFORM_DEFINITIONS[platform];
  const configured = hasSocialPlatformEnv(platform);
  const connected = account?.status === "connected";

  return (
    <div className="studio-v2-page">
      <PageHeader
        title={`${definition.label} connection`}
        description={`Connect ${definition.label} to make it an eligible channel for Campaign Brain planning.`}
      />

      {query.connected === "1" ? (
        <div className="notice success">Connected. New and regenerated campaigns can now plan for {definition.plannerPlatform}.</div>
      ) : null}
      {query.error ? <div className="notice error">{query.error}</div> : null}

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Channel status</span>
            <h2>{connected ? "Connected to Atlas" : "Not connected"}</h2>
          </div>
        </div>

        {account ? (
          <div className="panel">
            <p><strong>{account.display_name || account.username || definition.label}</strong></p>
            {account.username ? <p className="v2-muted-copy">{account.username}</p> : null}
            <p className="v2-muted-copy">
              Campaign planning: enabled. Automatic publishing: {account.can_publish ? "permission granted" : "not enabled"}.
            </p>
            <p className="v2-muted-copy">
              Disconnecting stops this channel from appearing in future campaign plans. Existing planned content is kept.
            </p>
          </div>
        ) : (
          <div className="panel">
            <p>{definition.description}</p>
            <p className="v2-muted-copy">
              Until this account is connected, Campaign Brain will not create any {definition.plannerPlatform} posting moments.
            </p>
          </div>
        )}

        <div className="actions">
          {configured ? (
            <a className="button primary" href={`/studio/settings/social/${platform}/connect`}>
              {connected ? `Reconnect ${definition.label}` : `Connect ${definition.label}`}
            </a>
          ) : (
            <span className="v2-muted-copy">
              OAuth app setup required: {definition.envVars.join(" + ")}
            </span>
          )}
          {connected ? (
            <form action={disconnectSocialConnection}>
              <input type="hidden" name="platform" value={platform} />
              <button className="button" type="submit">Disconnect</button>
            </form>
          ) : null}
          <Link className="button" href="/studio/settings">Back to settings</Link>
        </div>
      </section>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Permissions</span>
            <h2>Connection does not silently enable publishing</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          Atlas uses the minimum account-access scope by default so the channel can participate in campaign planning. Publishing scopes are requested only when ATLAS_SOCIAL_REQUEST_PUBLISH_SCOPES=true and the provider app is approved for them.
        </p>
      </section>
    </div>
  );
}
