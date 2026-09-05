-- Legacy /go redirects execute through the server-side service client only.
-- Keep the privacy-safe replacement unavailable to public database roles.
revoke all on function public.record_attribution_click(text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_attribution_click(text,text,text,text) to service_role;
