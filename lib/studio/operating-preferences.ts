import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { EnsemblisDatabase } from "@/types/ensemblis-database";

export type WorkspaceOperatingPreferences = {
  timeZone: string;
  locale: string;
  currency: string;
};

const LEGACY_OPERATING_DEFAULTS: WorkspaceOperatingPreferences = {
  timeZone: "Europe/Berlin",
  locale: "en",
  currency: "EUR",
};

const NEW_WORKSPACE_DEFAULTS: WorkspaceOperatingPreferences = {
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

function schemaDoesNotHaveOperatingPreferences(message: string) {
  const value = message.toLowerCase();
  return value.includes("column") && ["timezone", "locale", "currency"].some((field) => value.includes(field));
}

export async function loadWorkspaceOperatingPreferences(
  client: SupabaseClient<Database>,
  workspaceId: string,
): Promise<WorkspaceOperatingPreferences> {
  const db = client as unknown as SupabaseClient<EnsemblisDatabase>;
  const { data, error } = await db
    .from("workspaces")
    .select("timezone,locale,currency,legacy_owner_id")
    .eq("id", workspaceId)
    .maybeSingle();

  // Deploys and database migrations are intentionally decoupled. During the short
  // compatibility window where application code reaches production first, preserve
  // the Atlas-era timezone instead of making Today unavailable.
  if (error && schemaDoesNotHaveOperatingPreferences(error.message)) return LEGACY_OPERATING_DEFAULTS;
  if (error) throw new Error(error.message);

  const defaults = data?.legacy_owner_id ? LEGACY_OPERATING_DEFAULTS : NEW_WORKSPACE_DEFAULTS;
  return {
    timeZone: validTimeZone(data?.timezone) ?? defaults.timeZone,
    locale: validLocale(data?.locale) ?? defaults.locale,
    currency: validCurrency(data?.currency) ?? defaults.currency,
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
