import "server-only";

import { ResendEmailProvider } from "@/lib/email/resend";
import type { EmailProvider, SendEmailInput } from "@/lib/email/types";

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  provider ??= new ResendEmailProvider();
  return provider;
}

export function emailDeliveryConfigured() {
  return getEmailProvider().isConfigured();
}

export function sendEmail(input: SendEmailInput) {
  return getEmailProvider().send(input);
}

export type { EmailProvider, SendEmailInput, SendEmailResult } from "@/lib/email/types";
