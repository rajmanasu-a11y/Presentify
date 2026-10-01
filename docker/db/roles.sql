-- Sets the passwords of the Supabase service roles Presentify uses
-- (from the official self-hosted setup, without the roles of components
-- Presentify does not run). Executed once, when the database is first created.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
