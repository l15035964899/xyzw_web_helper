alter table public.tokens
  add column if not exists expected_role_id text,
  add column if not exists last_verified_role_id text,
  add column if not exists role_identity_verified_at timestamptz,
  add column if not exists role_identity_error text;
