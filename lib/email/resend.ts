import "server-only";

import {
  childExecutionContext,
  currentExecutionContext,
  EXECUTION_TRACE_HEADER,
  observeExecution,
} from "@/lib/observability/execution-context";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "@/lib/email/types";

const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_USER_AGENT = "Ensemblis/1.0 (+https://github.com/yotamon/Atlas-Irwin)";

type ResendSuccess = { id?: unknown };
type ResendFailure = { message?: unknown; name?: unknown };

function apiKey() {
  return process.env.RESEND_API_KEY?.trim() || "";
}

function defaultFrom() {
  return (
    process.env.ENSEMBLIS_EMAIL_FROM?.trim() ||
    process.env.CONTACT_EMAIL_FROM?.trim() ||
    ""
  );
}

function responseError(status: number, payload: ResendFailure) {
  const detail = typeof payload.message === "string" ? payload.message : "Unknown Resend error";
  const type = typeof payload.name === "string" ? ` (${payload.name})` : "";
  return new Error(`Resend email delivery failed with HTTP ${status}${type}: ${detail}`);
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  isConfigured() {
    return Boolean(apiKey() && defaultFrom());
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const key = apiKey();
    const from = input.from?.trim() || defaultFrom();
    if (!key || !from) {
      throw new Error("Resend email delivery is not configured.");
    }

    const parent = currentExecutionContext();
    const context = childExecutionContext({
      traceId: parent?.traceId,
      provider: this.name,
      operation: parent?.operation || "email.send",
    });

    return observeExecution("email.send", context, async () => {
      const headers = {
        ...input.headers,
        [EXECUTION_TRACE_HEADER]: context.traceId,
      };
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "User-Agent": RESEND_USER_AGENT,
          ...(input.idempotencyKey
            ? { "Idempotency-Key": input.idempotencyKey }
            : {}),
        },
        body: JSON.stringify({
          from,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          reply_to: input.replyTo,
          subject: input.subject,
          text: input.text,
          html: input.html,
          headers,
          tags: input.tags,
        }),
        cache: "no-store",
      });

      const payload = await response.json().catch(() => ({})) as ResendSuccess & ResendFailure;
      if (!response.ok) throw responseError(response.status, payload);
      if (typeof payload.id !== "string" || !payload.id) {
        throw new Error("Resend accepted the request without returning a message id.");
      }
      return { provider: this.name, messageId: payload.id };
    });
  }
}
