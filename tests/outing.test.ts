import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { suggest, execute, type Context } from "../src/server/service.ts"
import { createModule } from "../src/server/index.ts"
import { draftSchema, type Draft, type Place } from "../src/shared/outing.ts"
const place = (id: string, category: Place["category"] = "cafe", lat = 50): Place => ({
  id,
  name: id,
  category,
  location: { lat, lng: 4 },
  address: null,
})
const draft: Draft = {
  title: "Test day",
  filters: { radiusKm: 5 },
  slots: [
    { category: "cafe", placeId: null, anchor: false },
    { category: "museum", placeId: "anchor", anchor: true },
    { category: "restaurant", placeId: null, anchor: false },
  ],
}
test("suggestions respect distance, category, ties, uniqueness, order and replacement exclusions", () => {
  const pool = [
    place("anchor", "museum"),
    place("b"),
    place("a"),
    place("far", "restaurant", 51),
    place("dinner", "restaurant"),
  ]
  const d = suggest(draft, pool)
  assert.deepEqual(
    d.slots.map((s) => s.placeId),
    ["a", "anchor", "dinner"],
  )
  assert.equal(suggest(d, pool, 0).slots[0].placeId, "b")
  assert.equal(suggest(d, pool, 2).slots[2].placeId, null)
  const repeated = {
    ...draft,
    slots: [...draft.slots, { category: "cafe" as const, anchor: false, placeId: null }],
  }
  assert.deepEqual(
    suggest(repeated, pool).slots.map((s) => s.placeId),
    ["a", "anchor", "dinner", "b"],
  )
  assert.throws(() => suggest(draft, []), /anchor/)
  assert.throws(() => suggest(draft, pool, 1), /non-anchor/)
})
test("draft constraints", () => {
  assert.equal(draftSchema.safeParse({ ...draft, slots: [] }).success, false)
  assert.equal(
    draftSchema.safeParse({ ...draft, slots: [draft.slots[1], draft.slots[1]] }).success,
    false,
  )
  assert.equal(
    draftSchema.safeParse({ ...draft, slots: Array(9).fill(draft.slots[0]) }).success,
    false,
  )
  assert.equal(draftSchema.safeParse({ ...draft, filters: { radiusKm: 500 } }).success, false)
})
test("service ownership, filters, revisions, retries, unavailable references and MCP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "day-out-"))
  let pool = [place("anchor", "museum"), place("coffee"), place("food", "restaurant")]
  let filters: any[] = []
  const ctx: Context = {
    ownerId: "alice",
    dataDir: dir,
    hostFetch: async (path, init) => {
      assert.equal(path, "/api/search")
      const f = JSON.parse(init?.body as string)
      filters.push(f)
      return Response.json(pool.map((place) => ({ place })))
    },
  }
  try {
    const suggestion = await execute(
      "suggest_outing",
      {
        draft: {
          ...draft,
          filters: { radiusKm: 5, list: "list", tag: "tag", status: "want_to_go" },
        },
      },
      ctx,
    )
    assert.deepEqual(filters[1], {
      radiusKm: 5,
      list: "list",
      tag: "tag",
      status: "want_to_go",
      near: { lat: 50, lng: 4 },
    })
    const args = { draft: suggestion.draft, requestId: randomUUID() }
    const saved = await execute("save_outing", args, ctx)
    assert.deepEqual(await execute("save_outing", args, ctx), saved)
    await assert.rejects(
      execute("save_outing", { ...args, draft: { ...args.draft, title: "Changed" } }, ctx),
      /Request ID/,
    )
    assert.equal(
      (await execute("get_outing", { id: saved.id }, { ...ctx })).places.coffee.name,
      "coffee",
    )
    assert.deepEqual(await execute("list_outings", {}, { ...ctx, ownerId: "bob" }), [])
    await assert.rejects(
      execute("get_outing", { id: saved.id }, { ...ctx, ownerId: "bob" }),
      /not found/,
    )
    await assert.rejects(
      execute(
        "save_outing",
        { ...args, id: saved.id, expectedRevision: 2, requestId: randomUUID() },
        ctx,
      ),
      /changed/,
    )
    await assert.rejects(
      execute("save_outing", { draft, requestId: randomUUID() }, ctx),
      /empty slots/,
    )
    pool = []
    assert.deepEqual((await execute("get_outing", { id: saved.id }, ctx)).places, {})
    await execute(
      "save_outing",
      { ...args, id: saved.id, expectedRevision: 1, requestId: randomUUID() },
      ctx,
    )
    await assert.rejects(
      execute("save_outing", { ...args, requestId: randomUUID() }, ctx),
      /unavailable/,
    )
    await assert.rejects(execute("suggest_outing", { draft: suggestion.draft }, ctx), /anchor/)
    const tools = createModule().mcpTools
    const result = await tools
      .find((t) => t.def.name === "get_outing")!
      .handler({ id: saved.id }, ctx)
    assert.equal(result.ok, true)
    const del = { id: saved.id, expectedRevision: 2, requestId: randomUUID() }
    const deleted = await execute("delete_outing", del, ctx)
    assert.deepEqual(await execute("delete_outing", del, ctx), deleted)
    await assert.rejects(execute("get_outing", { id: saved.id }, ctx), /not found/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
