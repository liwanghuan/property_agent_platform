// Runs the real migrations + seed in PGlite (in-process Postgres) behind a minimal shim of
// what Supabase provides: the anon/authenticated/service_role roles, default grants,
// auth.users/auth.identities and auth.uid(). RLS is enforced by Postgres itself, so these
// tests exercise the same policies that run in Supabase.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SUPABASE_DIR = path.resolve(import.meta.dirname, "..");

const SUPABASE_SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text, phone text unique,
  phone_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text,
  email_change_token_new text, email_change text, phone_change text, phone_change_token text
);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users on delete cascade, provider_id text,
  identity_data jsonb, provider text, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz
);

-- Same resolution order as Supabase's auth.uid().
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase's default privileges: RLS, not grants, is the barrier.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);

  const migrationsDir = path.join(SUPABASE_DIR, "migrations");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  await db.exec(readFileSync(path.join(SUPABASE_DIR, "seed.sql"), "utf8"));
  return db;
}

export type Role = "anon" | "authenticated" | "service_role";

/**
 * Runs `fn` as a Supabase API request would: `role` plus JWT claims for `uid`.
 * Always rolls back, so writes made inside never leak into other tests.
 */
export async function as<T>(
  db: PGlite,
  who: { role: Role; uid?: string },
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await db.transaction(async (tx) => {
    const claims = who.uid ? { sub: who.uid, role: who.role } : { role: who.role };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${who.role}`);
    try {
      result = await fn(tx);
    } catch (e) {
      error = e;
    }
    await tx.rollback();
  });
  if (error) throw error;
  return result as T;
}

export const asAgent = <T>(db: PGlite, uid: string, fn: (tx: Transaction) => Promise<T>) =>
  as(db, { role: "authenticated", uid }, fn);

/** Runs a statement in a savepoint and returns the error message, or null if it succeeded. */
export async function errorOf(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec("savepoint probe");
  try {
    await tx.query(sql, params);
    await tx.exec("release savepoint probe");
    return null;
  } catch (e) {
    await tx.exec("rollback to savepoint probe");
    return (e as Error).message;
  }
}

// Seed identities (supabase/seed.sql)
export const LEADER = "00000000-0000-4000-8000-000000000001";
export const AGENT = (n: 2 | 3 | 4 | 5 | 6) => `00000000-0000-4000-8000-00000000000${n}`;
export const TEAM = "10000000-0000-4000-8000-000000000001";
export const LISTING = (n: number) => `20000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
