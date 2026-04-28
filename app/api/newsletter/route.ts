import { NextResponse } from "next/server";

type NewsletterPayload = {
  name?: unknown;
  email?: unknown;
  website?: unknown;
};

type MailerLiteErrorResponse = {
  message?: string;
  errors?: Record<string, string[]>;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseGroupIds(value: string | undefined) {
  return value
    ?.split(",")
    .map((groupId) => groupId.trim())
    .filter(Boolean);
}

function firstMailerLiteError(error: MailerLiteErrorResponse) {
  const firstFieldError = Object.values(error.errors || {}).flat()[0];
  return firstFieldError || error.message;
}

export async function POST(request: Request) {
  let payload: NewsletterPayload;

  try {
    payload = (await request.json()) as NewsletterPayload;
  } catch {
    return NextResponse.json(
      { message: "Please send a valid signup request." },
      { status: 400 },
    );
  }

  const website = cleanText(payload.website, 120);
  if (website) {
    return NextResponse.json({ message: "You're on the list." });
  }

  const name = cleanText(payload.name, 100);
  const email = cleanText(payload.email, 180).toLowerCase();

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { message: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const apiKey = process.env.MAILERLITE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { message: "Newsletter signup is not configured yet." },
      { status: 503 },
    );
  }

  const groups = parseGroupIds(process.env.MAILERLITE_GROUP_IDS);
  const mailerLitePayload = {
    email,
    ...(name ? { fields: { name } } : {}),
    ...(groups?.length ? { groups } : {}),
  };

  try {
    const response = await fetch("https://connect.mailerlite.com/api/subscribers", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mailerLitePayload),
    });

    if (!response.ok) {
      let mailerLiteError: MailerLiteErrorResponse = {};

      try {
        mailerLiteError =
          (await response.json()) as MailerLiteErrorResponse;
      } catch {
        mailerLiteError = {};
      }

      if (response.status === 401 || response.status === 403) {
        return NextResponse.json(
          { message: "Newsletter signup is not configured correctly." },
          { status: 503 },
        );
      }

      if (response.status === 429) {
        return NextResponse.json(
          { message: "Too many signup attempts. Please try again soon." },
          { status: 429 },
        );
      }

      return NextResponse.json(
        {
          message:
            firstMailerLiteError(mailerLiteError) ||
            "Subscription could not be saved right now.",
        },
        { status: response.status === 422 ? 400 : 502 },
      );
    }

    return NextResponse.json({
      message: "You're on the list. Check your inbox soon.",
    });
  } catch {
    return NextResponse.json(
      { message: "Subscription could not be saved right now." },
      { status: 502 },
    );
  }
}
