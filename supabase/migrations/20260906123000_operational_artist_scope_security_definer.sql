-- Keep private authorization helpers private while allowing operational lineage triggers
-- to validate service-role writes used by durable automation.
--
-- The trigger function delegates the actual membership/ownership check to
-- private.assert_operational_artist_owner(). Running the trigger as its postgres owner
-- avoids granting callers USAGE on the private schema or EXECUTE on private helpers.

alter function private.validate_operational_artist_scope() security definer;

comment on function private.validate_operational_artist_scope() is
  'Trigger-only artist-lineage validator. Runs as its postgres owner so callers never need USAGE on the private schema; it delegates membership authorization to private.assert_operational_artist_owner and preserves private-schema isolation.';
