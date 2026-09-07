export type EmailTag = {
  name: string;
  value: string;
};

export type SendEmailInput = {
  from?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  tags?: EmailTag[];
  idempotencyKey?: string;
};

export type SendEmailResult = {
  provider: string;
  messageId: string;
};

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
