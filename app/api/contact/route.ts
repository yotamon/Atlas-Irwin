import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { emailDeliveryConfigured, sendEmail } from "@/lib/email/provider";
import {
  createExecutionContext,
  EXECUTION_TRACE_HEADER,
  logExecutionEvent,
  runWithExecutionContext,
  traceIdFromRequest,
} from "@/lib/observability/execution-context";

function contactRecipientEmail() {
  return process.env.CONTACT_EMAIL_TO?.trim() || "";
}

function contactSenderEmail() {
  return process.env.CONTACT_EMAIL_FROM?.trim() || undefined;
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

function contactResponse(
  traceId: string,
  body: { message: string },
  status = 200,
) {
  const response = NextResponse.json(body, { status });
  response.headers.set(EXECUTION_TRACE_HEADER, traceId);
  return response;
}

export async function POST(request: Request) {
  const traceId = traceIdFromRequest(request);
  const context = createExecutionContext({ traceId, operation: "contact.submit" });

  return runWithExecutionContext(context, async () => {
    const ip = getClientIp(request);
    if (!checkRateLimit(ip, { windowMs: 60_000, maxRequests: 5 })) {
      logExecutionEvent("warn", "contact.rate_limited");
      return contactResponse(
        traceId,
        { message: "Too many requests. Please try again later." },
        429,
      );
    }

    let payload: ContactPayload;
    try {
      payload = (await request.json()) as ContactPayload;
    } catch {
      return contactResponse(
        traceId,
        { message: "Please send a valid contact message." },
        400,
      );
    }

    const company = cleanText(payload.company, 120);
    if (company) {
      logExecutionEvent("info", "contact.honeypot_rejected");
      return contactResponse(traceId, { message: "Message sent. Thank you." });
    }

    const name = cleanText(payload.name, 100);
    const email = cleanText(payload.email, 180);
    const message = cleanText(payload.message, 5000);

    if (!name || !message || !isValidEmail(email)) {
      return contactResponse(
        traceId,
        { message: "Please add your name, a valid email, and a message." },
        400,
      );
    }

    const to = contactRecipientEmail();
    if (!to || !emailDeliveryConfigured()) {
      logExecutionEvent("error", "contact.email_not_configured");
      return contactResponse(
        traceId,
        { message: "Email delivery is not configured yet." },
        503,
      );
    }

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeMessage = escapeHtml(message).replaceAll("\n", "<br />");
    const subjectName = name.replace(/[\r\n]+/g, " ").trim();

    try {
      const result = await sendEmail({
        from: contactSenderEmail(),
        to,
        replyTo: email,
        subject: `New website message from ${subjectName}`,
        text: [`Name: ${name}`, `Email: ${email}`, "", message].join("\n"),
        html: `
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          <p><strong>Message:</strong></p>
          <p>${safeMessage}</p>
        `,
      });
      logExecutionEvent("info", "contact.email_delivered", {
        email_provider: result.provider,
        email_message_id: result.messageId,
      });
      return contactResponse(traceId, { message: "Message sent. Thank you." });
    } catch (error) {
      logExecutionEvent("error", "contact.email_delivery_failed", {
        error_message: error instanceof Error ? error.message : String(error),
      });
      return contactResponse(
        traceId,
        { message: "Message could not be sent right now." },
        500,
      );
    }
  });
}
