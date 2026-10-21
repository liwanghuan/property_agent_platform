import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { AGENT, LEADER, LISTING, TEAM, as, asAgent, createTestDb, errorOf } from "./harness";

const PRIVATE_TABLES = [
  "intake_batches",
  "raw_messages",
  "contacts",
  "buyer_needs",
  "viewing_sessions",
  "viewing_items",
  "client_feedback",
  "content_packs",
] as const;

// Team-visible + confirmed listings in the seed.
const TEAM_CONFIRMED = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19];

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

const rows = async <T = Record<string, unknown>>(
  tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  sql: string,
  params: unknown[] = [],
) => (await tx.query(sql, params)).rows as T[];

describe("schema guard", () => {
  it("every public table has RLS enabled", async () => {
    const res = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(res.rows).toEqual([]);
  });
});

describe("private layer", () => {
  it.each(PRIVATE_TABLES)("agent sees only their own %s rows", async (table) => {
    const seen = await asAgent(db, AGENT(2), (tx) => rows<{ agent_id: string }>(tx, `select agent_id from public.${table}`));
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((r) => r.agent_id))).toEqual(new Set([AGENT(2)]));
  });

  it.each(PRIVATE_TABLES)("agent A cannot update or delete agent B's %s rows", async (table) => {
    await asAgent(db, AGENT(2), async (tx) => {
      const upd = await tx.query(`update public.${table} set agent_id = agent_id where agent_id = $1`, [AGENT(3)]);
      const del = await tx.query(`delete from public.${table} where agent_id = $1`, [AGENT(3)]);
      expect(upd.affectedRows).toBe(0);
      expect(del.affectedRows).toBe(0);
    });
    const stillThere = await db.query(`select 1 from public.${table} where agent_id = $1`, [AGENT(3)]);
    expect(stillThere.rows.length).toBeGreaterThan(0);
  });

  it("agent A cannot insert rows owned by agent B", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      const err = await errorOf(tx, "insert into public.contacts (agent_id, name) values ($1, 'x')", [AGENT(3)]);
      expect(err).toMatch(/row-level security/);
    });
  });

  it("agent A cannot attach their rows to agent B's parent rows", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      const err = await errorOf(
        tx,
        "insert into public.raw_messages (agent_id, batch_id, kind, text, content_hash) values ($1, $2, 'text', 'x', 'h')",
        [AGENT(2), "40000000-0000-4000-8000-000000000003"],
      );
      expect(err).toMatch(/foreign key/);
    });
  });

  it("viewing items cannot reference a listing the agent cannot see", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      // listing 8 is agent 3's private listing
      const err = await errorOf(
        tx,
        "insert into public.viewing_items (agent_id, session_id, listing_ref_id) values ($1, $2, $3)",
        [AGENT(2), "70000000-0000-4000-8000-000000000002", LISTING(8)],
      );
      expect(err).toMatch(/row-level security/);
      const ok = await errorOf(
        tx,
        "insert into public.viewing_items (agent_id, session_id, listing_ref_id) values ($1, $2, $3)",
        [AGENT(2), "70000000-0000-4000-8000-000000000002", LISTING(5)],
      );
      expect(ok).toBeNull();
    });
  });
});

describe("listings", () => {
  it("agent sees all own listings plus team-visible confirmed listings of teammates", async () => {
    const seen = await asAgent(db, AGENT(2), (tx) => rows<{ id: string }>(tx, "select id from public.listings"));
    const own = [1, 2, 3, 4];
    const expected = new Set([...own, ...TEAM_CONFIRMED].map(LISTING));
    expect(new Set(seen.map((r) => r.id))).toEqual(expected);
  });

  it("private, draft and archived listings of teammates are hidden", async () => {
    const seen = await asAgent(db, AGENT(2), (tx) =>
      rows(tx, "select id from public.listings where id = any($1)", [[8, 12, 16, 20].map(LISTING)]),
    );
    expect(seen).toEqual([]);
  });

  it("agent cannot modify a teammate's listing", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      const upd = await tx.query("update public.listings set asking_price = 1 where id = $1", [LISTING(5)]);
      expect(upd.affectedRows).toBe(0);
    });
  });

  it("agent cannot publish a listing into another team", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      const err = await errorOf(
        tx,
        "insert into public.listings (agent_id, team_id, visibility) values ($1, gen_random_uuid(), 'private')",
        [AGENT(2)],
      );
      expect(err).toMatch(/row-level security|foreign key/);
    });
  });

  it("team-visible listings cannot carry an exact unit number", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      const err = await errorOf(
        tx,
        "insert into public.listings (agent_id, team_id, visibility, address) values ($1, $2, 'team', '8 Aster Bay Walk #23-01')",
        [AGENT(2), TEAM],
      );
      expect(err).toMatch(/listings_no_unit_no_when_shared/);
    });
  });
});

describe("need cards and matches", () => {
  it("need_cards are not directly readable by teammates", async () => {
    const seen = await asAgent(db, AGENT(2), (tx) => rows<{ id: string }>(tx, "select id from public.need_cards"));
    expect(seen.map((r) => r.id)).toEqual(["60000000-0000-4000-8000-000000000002"]);
  });

  it("team_need_cards() returns team cards without any owner identifier", async () => {
    const cards = await asAgent(db, AGENT(2), (tx) => rows<Record<string, unknown>>(tx, "select * from public.team_need_cards()"));
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(Object.keys(card)).not.toContain("buyer_need_id");
      expect(Object.keys(card)).not.toContain("agent_id");
      expect(JSON.stringify(card)).not.toContain("00000000-0000-4000-8000-00000000000");
    }
    expect(cards.filter((c) => c.is_mine)).toHaveLength(1);
  });

  it("matches are visible only to the listing owner and the need owner", async () => {
    const count = async (uid: string) =>
      (await asAgent(db, uid, (tx) => rows(tx, "select id from public.matches"))).length;
    expect(await count(AGENT(2))).toBe(1); // listing owner
    expect(await count(AGENT(3))).toBe(1); // need owner
    expect(await count(AGENT(4))).toBe(0);
    expect(await count(LEADER)).toBe(0);
  });

  it("listing owner cannot resolve the buyer-side agent from a match", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      const [match] = await rows<Record<string, unknown>>(tx, "select * from public.matches");
      expect(Object.values(match)).not.toContain(AGENT(3));
      expect(await rows(tx, "select * from public.need_cards where id = $1", [match.need_card_id])).toEqual([]);
      expect(await rows(tx, "select * from public.buyer_needs where agent_id = $1", [AGENT(3)])).toEqual([]);
    });
  });

  it("clients cannot change match state directly", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      const err = await errorOf(tx, "update public.matches set listing_side_status = 'interested'");
      expect(err).toMatch(/permission denied/);
    });
  });
});

describe("leader", () => {
  it.each([...PRIVATE_TABLES, "need_cards"])("leader cannot read any %s row", async (table) => {
    const seen = await asAgent(db, LEADER, (tx) => rows(tx, `select * from public.${table}`));
    expect(seen).toEqual([]);
  });

  it("team_stats returns aggregates only", async () => {
    const [stats] = await asAgent(db, LEADER, (tx) => rows<Record<string, unknown>>(tx, "select * from public.team_stats()"));
    expect(stats.agents_total).toBe(6);
    expect(stats.listings_team_visible_total).toBe(TEAM_CONFIRMED.length);
    expect(stats.need_cards_active).toBe(5);
    for (const [key, value] of Object.entries(stats)) {
      if (key !== "day") expect(typeof value).toBe("number");
    }
  });

  it("team_listings_overview returns only team-visible confirmed listings", async () => {
    const list = await asAgent(db, LEADER, (tx) => rows<{ listing_id: string }>(tx, "select * from public.team_listings_overview()"));
    expect(new Set(list.map((r) => r.listing_id))).toEqual(new Set(TEAM_CONFIRMED.map(LISTING)));
  });

  it("inactive_agents flags agents with no recent activity", async () => {
    const list = await asAgent(db, LEADER, (tx) => rows<{ agent_id: string }>(tx, "select * from public.inactive_agents(7)"));
    expect(new Set(list.map((r) => r.agent_id))).toEqual(new Set([AGENT(6), LEADER]));
  });

  it("non-leaders cannot call leader functions", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      for (const fn of ["team_stats()", "team_listings_overview()", "inactive_agents(7)"]) {
        expect(await errorOf(tx, `select * from public.${fn}`)).toMatch(/leader access required/);
      }
    });
  });
});

describe("profiles and onboarding", () => {
  it("agents see teammates but cannot edit them or their own role", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      expect(await rows(tx, "select id from public.agents")).toHaveLength(6);
      const upd = await tx.query("update public.agents set display_name = 'x' where id = $1", [AGENT(3)]);
      expect(upd.affectedRows).toBe(0);
      expect(await errorOf(tx, "update public.agents set role = 'leader' where id = $1", [AGENT(2)])).toMatch(/permission denied/);
      expect(await errorOf(tx, "update public.agents set team_id = null where id = $1", [AGENT(2)])).toMatch(/permission denied/);
      expect(await errorOf(tx, "insert into public.agents (id, display_name, cea_reg_no, agency_name, agency_licence_no) values (gen_random_uuid(), 'a','b','c','d')")).toMatch(/permission denied/);
    });
  });

  it("an invited phone completes onboarding into the invited team", async () => {
    const uid = "00000000-0000-4000-8000-000000000007";
    await db.query("insert into auth.users (id, phone) values ($1, '6590000007') on conflict do nothing", [uid]);
    const [agent] = await asAgent(db, uid, (tx) =>
      rows<Record<string, unknown>>(tx, "select * from public.complete_onboarding('New Demo', 'r900007g', 'Demo Realty Pte Ltd', 'l3000001z')"),
    );
    expect(agent.team_id).toBe(TEAM);
    expect(agent.role).toBe("agent");
    expect(agent.cea_reg_no).toBe("R900007G");
  });

  it("an uninvited phone cannot onboard", async () => {
    const uid = "00000000-0000-4000-8000-000000000099";
    await db.query("insert into auth.users (id, phone) values ($1, '6599999999') on conflict do nothing", [uid]);
    await asAgent(db, uid, async (tx) => {
      expect(await errorOf(tx, "select public.complete_onboarding('X', 'R1', 'A', 'L1')")).toMatch(/no team invite/);
    });
  });

  it("onboarding requires CEA fields", async () => {
    const uid = "00000000-0000-4000-8000-000000000007";
    await asAgent(db, uid, async (tx) => {
      expect(await errorOf(tx, "select public.complete_onboarding('New Demo', '', 'Demo Realty', 'L1')")).toMatch(/check constraint/);
    });
  });
});

describe("other surfaces", () => {
  it("anonymous clients have no table or function access", async () => {
    await as(db, { role: "anon" }, async (tx) => {
      for (const t of ["listings", "agents", "contacts", "teams"]) {
        expect(await errorOf(tx, `select * from public.${t}`)).toMatch(/permission denied/);
      }
      expect(await errorOf(tx, "select * from public.team_need_cards()")).toMatch(/permission denied/);
      expect(await errorOf(tx, "select * from public.team_stats()")).toMatch(/permission denied/);
    });
  });

  it("ai_calls is service-role only", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      expect(await errorOf(tx, "select * from public.ai_calls")).toMatch(/permission denied/);
    });
    await as(db, { role: "service_role" }, async (tx) => {
      expect(
        await errorOf(tx, "insert into public.ai_calls (task, prompt_version, model, status) values ('t', 'v1', 'm', 'ok')"),
      ).toBeNull();
    });
  });

  it("agents can only log events as themselves", async () => {
    await asAgent(db, AGENT(2), async (tx) => {
      expect(await errorOf(tx, "insert into public.events (team_id, agent_id, type) values ($1, $2, 'x')", [TEAM, AGENT(3)])).toMatch(/row-level security/);
      expect(await errorOf(tx, "insert into public.events (team_id, agent_id, type) values ($1, $2, 'x')", [TEAM, AGENT(2)])).toBeNull();
      expect(await rows(tx, "select * from public.events where agent_id <> $1", [AGENT(2)])).toEqual([]);
    });
  });
});
