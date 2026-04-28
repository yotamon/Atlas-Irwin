"use client";

import { FormEvent, useState } from "react";

type FormState = {
  name: string;
  email: string;
  message: string;
  company: string;
};

type SubmitState =
  | { type: "idle"; message: "" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

const initialFormState: FormState = {
  name: "",
  email: "",
  message: "",
  company: "",
};

export function ContactForm() {
  const [form, setForm] = useState(initialFormState);
  const [submitState, setSubmitState] = useState<SubmitState>({
    type: "idle",
    message: "",
  });
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSending(true);
    setSubmitState({ type: "idle", message: "" });

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(result.message || "Message could not be sent.");
      }

      setForm(initialFormState);
      setSubmitState({
        type: "success",
        message: result.message || "Message sent. Thank you.",
      });
    } catch (error) {
      setSubmitState({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Message could not be sent.",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="section-card rounded-[1.45rem] p-5 sm:p-6 lg:p-7"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 font-display text-[0.98rem] uppercase tracking-[0.16em] text-teal">
          Name
          <input
            required
            autoComplete="name"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            className="min-h-12 rounded-[0.7rem] border border-line bg-surface-soft px-4 font-sans text-[1rem] normal-case tracking-normal text-ink outline-none transition-colors duration-200 placeholder:text-muted focus:border-teal"
          />
        </label>

        <label className="grid gap-2 font-display text-[0.98rem] uppercase tracking-[0.16em] text-teal">
          Email
          <input
            required
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            className="min-h-12 rounded-[0.7rem] border border-line bg-surface-soft px-4 font-sans text-[1rem] normal-case tracking-normal text-ink outline-none transition-colors duration-200 placeholder:text-muted focus:border-teal"
          />
        </label>
      </div>

      <label className="mt-4 grid gap-2 font-display text-[0.98rem] uppercase tracking-[0.16em] text-teal">
        Message
        <textarea
          required
          rows={6}
          value={form.message}
          onChange={(event) =>
            setForm((current) => ({ ...current, message: event.target.value }))
          }
          className="min-h-40 resize-y rounded-[0.7rem] border border-line bg-surface-soft px-4 py-3 font-sans text-[1rem] leading-7 normal-case tracking-normal text-ink outline-none transition-colors duration-200 placeholder:text-muted focus:border-teal"
        />
      </label>

      <label className="hidden" aria-hidden="true">
        Company
        <input
          tabIndex={-1}
          autoComplete="off"
          value={form.company}
          onChange={(event) =>
            setForm((current) => ({ ...current, company: event.target.value }))
          }
        />
      </label>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="submit"
          disabled={isSending}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 font-display text-[1.02rem] uppercase tracking-[0.18em] text-paper transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
        >
          {isSending ? "Sending" : "Send Message"}
        </button>

        <p
          aria-live="polite"
          className={`min-h-6 text-[0.95rem] leading-6 ${
            submitState.type === "success"
              ? "text-teal"
              : submitState.type === "error"
                ? "text-coral"
                : "text-muted"
          }`}
        >
          {submitState.message}
        </p>
      </div>
    </form>
  );
}
