"use client";

import { FormEvent, useState } from "react";
import { HiArrowRight, HiCheck, HiSparkles } from "react-icons/hi2";

type FormState = {
  name: string;
  email: string;
  website: string;
};

type SubmitState =
  | { type: "idle"; message: "" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

const initialFormState: FormState = {
  name: "",
  email: "",
  website: "",
};

export function NewsletterSignup() {
  const [form, setForm] = useState(initialFormState);
  const [submitState, setSubmitState] = useState<SubmitState>({
    type: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitState({ type: "idle", message: "" });

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(result.message || "Subscription could not be saved.");
      }

      setForm(initialFormState);
      setSubmitState({
        type: "success",
        message: result.message || "You're on the list.",
      });
    } catch (error) {
      setSubmitState({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Subscription could not be saved.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mx-auto mt-8 w-full max-w-330 px-5 pb-16 sm:px-8 lg:mt-10 lg:px-12 lg:pb-20">
      <div className="section-card overflow-hidden rounded-[1.6rem] lg:rounded-[2rem]">
        <div className="grid min-h-[20rem] gap-0 lg:grid-cols-[0.88fr_1.12fr]">
          <div className="relative overflow-hidden bg-ink px-6 py-9 text-paper sm:px-8 lg:px-10 lg:py-11">
            <div
              aria-hidden="true"
              className="absolute right-0 top-12 h-px w-72 origin-right -rotate-12 bg-paper/18"
            />
            <div
              aria-hidden="true"
              className="absolute bottom-18 left-0 h-px w-64 rotate-12 bg-accent/30"
            />
            <div className="relative z-10 flex h-full flex-col justify-between gap-12">
              <div>
                <p className="font-display text-[1rem] uppercase tracking-[0.26em] text-accent">
                  Newsletter
                </p>
                <h2 className="mt-3 font-display text-[3.4rem] uppercase leading-[0.86] tracking-[0.05em] sm:text-[4.6rem] lg:text-[5.1rem]">
                  Stay In The Loop
                </h2>
              </div>

              <p className="max-w-110 text-[1.02rem] leading-8 text-paper/76">
                Occasional release notes, live dates, sketches from the studio,
                and early listens before they land everywhere else.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="grid content-center gap-5 px-6 py-8 sm:px-8 lg:px-10 lg:py-11"
          >
            <div className="grid gap-4 sm:grid-cols-[0.82fr_1fr]">
              <label className="grid gap-2 font-display text-[0.96rem] uppercase tracking-[0.16em] text-teal">
                Name
                <input
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                  className="min-h-12 rounded-[0.72rem] border border-line bg-surface-soft px-4 font-sans text-base normal-case tracking-normal text-ink transition-colors duration-200 placeholder:text-muted focus:border-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
                />
              </label>

              <label className="grid gap-2 font-display text-[0.96rem] uppercase tracking-[0.16em] text-teal">
                Email
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="you@example.com"
                  className="min-h-12 rounded-[0.72rem] border border-line bg-surface-soft px-4 font-sans text-base normal-case tracking-normal text-ink transition-colors duration-200 placeholder:text-muted focus:border-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
                />
              </label>
            </div>

            <label className="hidden" aria-hidden="true">
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    website: event.target.value,
                  }))
                }
              />
            </label>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="submit"
                disabled={isSubmitting}
                className="group inline-flex min-h-13 items-center justify-center gap-3 rounded-full bg-accent px-6 font-display text-[1.02rem] uppercase tracking-[0.18em] text-[#111111] shadow-[0_2px_0_var(--shadow)] transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
              >
                {submitState.type === "success" ? (
                  <HiCheck aria-hidden="true" className="h-5 w-5" />
                ) : isSubmitting ? (
                  <HiSparkles
                    aria-hidden="true"
                    className="h-5 w-5 animate-pulse"
                  />
                ) : (
                  <HiArrowRight
                    aria-hidden="true"
                    className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1"
                  />
                )}
                {isSubmitting ? "Joining..." : "Join The List"}
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
                {submitState.message || "No spam. Just the important notes."}
              </p>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
