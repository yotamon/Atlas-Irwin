import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

function contactRecipientEmail() {
  return (
    process.env.CONTACT_EMAIL_TO?.trim() ||
    process.env.CONTACT_SMTP_USER?.trim() ||
    ""
  );
}

type ContactPayload = {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  company?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(request: Request) {
  /* ── Rate limiting ──────────────────────────────────────── */
  const ip = getClientIp(request);

  if (!checkRateLimit(ip, { windowMs: 60_000, maxRequests: 5 })) {
    return NextResponse.json(
      { message: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  let payload: ContactPayload;

  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return NextResponse.json(
      { message: "Please send a valid contact message." },
      { status: 400 },
    );
  }

  const company = cleanText(payload.company, 120);
  if (company) {
    return NextResponse.json({ message: "Message sent. Thank you." });
  }

  const name = cleanText(payload.name, 100);
  const email = cleanText(payload.email, 180);
  const message = cleanText(payload.message, 5000);

  if (!name || !message || !isValidEmail(email)) {
    return NextResponse.json(
      { message: "Please add your name, a valid email, and a message." },
      { status: 400 },
    );
  }

  const host = process.env.CONTACT_SMTP_HOST;
  const port = Number(process.env.CONTACT_SMTP_PORT || "587");
  const user = process.env.CONTACT_SMTP_USER;
  const pass = process.env.CONTACT_SMTP_PASS;
  const from = process.env.CONTACT_EMAIL_FROM || user;

  const to = contactRecipientEmail();

  if (!host || !Number.isFinite(port) || !user || !pass || !from || !to) {
    return NextResponse.json(
      { message: "Email delivery is not configured yet." },
      { status: 503 },
    );
  }

  const secure =
    process.env.CONTACT_SMTP_SECURE === "true" ||
    (!process.env.CONTACT_SMTP_SECURE && port === 465);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replaceAll("\n", "<br />");

  try {
    await transporter.sendMail({
      from: {
        name: "Atlas Irwin Website",
        address: from,
      },
      to,
      replyTo: {
        name,
        address: email,
      },
      subject: `New website message from ${name}`,
      text: [`Name: ${name}`, `Email: ${email}`, "", message].join("\n"),
      html: `
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Message:</strong></p>
        <p>${safeMessage}</p>
      `,
    });

    return NextResponse.json({ message: "Message sent. Thank you." });
  } catch {
    return NextResponse.json(
      { message: "Message could not be sent right now." },
      { status: 500 },
    );
  }
}
