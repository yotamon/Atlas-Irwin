import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type WorkspaceOperatingPreferences = {
  timeZone: string;
  locale: string;
  currency: string;
};

const DEFAULT_OPERATING_PREFERENCES: WorkspaceOperatingPreferences = {
  timeZone: "UTC",
  locale: "en",
  currency: "EUR",
};

function validTimeZone(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return null;
  }
}

function validLocale(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

function validCurrency(value: string | null | undefined) {
  const currency = value?.trim().toUpperCase();
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

export async function loadWorkspaceOperatingPreferences(
  client: SupabaseClient<Database>,
  workspaceId: string,
): Promise<WorkspaceOperatingPreferences> {
  const { data, error } = await client
    .from("workspaces")
    .select("timezone,locale,currency")
    .eq("id", workspaceId)
    .single();
  if (error) throw new Error(error.message);

  return {
    timeZone: validTimeZone(data.timezone) ?? DEFAULT_OPERATING_PREFERENCES.timeZone,
    locale: validLocale(data.locale) ?? DEFAULT_OPERATING_PREFERENCES.locale,
    currency: validCurrency(data.currency) ?? DEFAULT_OPERATING_PREFERENCES.currency,
  };
}

export function formatOperatingDate(
  value: string | null | undefined,
  preferences: Pick<WorkspaceOperatingPreferences, "timeZone" | "locale">,
) {
  if (!value) return "No date";
  if (value.length === 10) {
    return new Intl.DateTimeFormat(preferences.locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  }
  return new Intl.DateTimeFormat(preferences.locale, {
    month: "short",
    day: "numeric",
    timeZone: preferences.timeZone,
  }).format(new Date(value));
}

export function formatOperatingDateTime(
  value: string | null | undefined,
  preferences: Pick<WorkspaceOperatingPreferences, "timeZone" | "locale">,
) {
  if (!value) return "Time not set";
  return new Intl.DateTimeFormat(preferences.locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: preferences.timeZone,
  }).format(new Date(value));
}
