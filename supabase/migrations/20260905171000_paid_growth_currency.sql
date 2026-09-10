-- Autonomy spend ceilings are denominated in USD in v1. Paid experiments therefore carry an
-- explicit currency and v1 execution is restricted to USD rather than silently mixing currencies.

alter table public.paid_growth_experiments
  add column currency text not null default 'USD'
  check (currency ~ '^[A-Z]{3}$');

alter table public.paid_growth_experiments
  add constraint paid_growth_v1_currency_usd check (currency = 'USD');

comment on column public.paid_growth_experiments.currency is
  'ISO 4217 currency. Paid Growth v1 is USD-only because artist autonomy spend ceilings are currently USD-denominated.';
