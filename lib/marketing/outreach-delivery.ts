import "server-only";

export type OutreachRecipient = {
  name: string;
  email: string | null;
  handleOrUrl: string | null;
  platform: string | null;
};

export type OutreachDeliveryResult = {
  status: "sent" | "manual_handoff";
  externalId?: string;
  externalUrl?: string;
};

function envKey(channel: string) {
  return channel.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function config(channel: string) {
  const key = envKey(channel);
  return {
    sendUrl: process.env[`OUTREACH_CHANNEL_${key}_SEND_URL`]?.trim() || "",
    token: process.env[`OUTREACH_CHANNEL_${key}_TOKEN`]?.trim() || "",
  };
}

export function outreachCapability(channel: string) {
  const connection = config(channel);
  return {
    id: connection.sendUrl ? `connected:${envKey(channel).toLowerCase()}` : `manual:${envKey(channel).toLowerCase()}`,
    automatedSending: Boolean(connection.sendUrl),
  };
}

export async function deliverOutreach({
  channel,
  recipient,
  message,
}: {
  channel: string;
  recipient: OutreachRecipient;
  message: string;
}): Promise<OutreachDeliveryResult> {
  const connection = config(channel);
  if (!connection.sendUrl) return { status: "manual_handoff" };

  const response = await fetch(connection.sendUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(connection.token ? { authorization: `Bearer ${connection.token}` } : {}),
    },
    body: JSON.stringify({ channel, recipient, message }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`${channel} outreach adapter returned ${response.status}: ${detail}`);
  }
  const payload = await response.json().catch(() => ({})) as { externalId?: string; externalUrl?: string };
  return { status: "sent", externalId: payload.externalId, externalUrl: payload.externalUrl };
}
