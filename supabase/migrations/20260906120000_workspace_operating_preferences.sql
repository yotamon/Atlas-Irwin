alter table public.workspaces
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists currency text;

-- Preserve the production behavior of workspaces created by the Atlas-era
-- compatibility migration. New workspaces deliberately stay unset and resolve to
-- product-safe defaults until onboarding/settings captures their operating context.
update public.workspaces
set timezone = coalesce(timezone, 'Europe/Berlin'),
    locale = coalesce(locale, 'en'),
    currency = coalesce(currency, 'EUR')
where legacy_owner_id is not null;

alter table public.workspaces
  drop constraint if exists workspaces_timezone_nonempty,
  add constraint workspaces_timezone_nonempty check (timezone is null or length(trim(timezone)) > 0),
  drop constraint if exists workspaces_locale_nonempty,
  add constraint workspaces_locale_nonempty check (locale is null or length(trim(locale)) > 0),
  drop constraint if exists workspaces_currency_iso_shape,
  add constraint workspaces_currency_iso_shape check (currency is null or currency ~ '^[A-Z]{3}$');
