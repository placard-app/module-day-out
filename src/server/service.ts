import { DatabaseSync } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { schemas, distance, type Draft, type Place } from "../shared/outing.ts"
export type Context = {
  ownerId: string
  dataDir: string
  hostFetch: (path: string, init?: RequestInit) => Promise<Response>
  pathSuffix?: string
}
export class Failure extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
export async function host(ctx: Context, path: string, body?: unknown) {
  const r = await ctx.hostFetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  )
  if (!r.ok) throw new Failure(r.status, "Could not load library")
  return r.json()
}
export function suggest(draft: Draft, places: Place[], replaceIndex?: number): Draft {
  const anchor = places.find((p) => p.id === draft.slots.find((s) => s.anchor)?.placeId)
  if (!anchor) throw new Failure(400, "Replace the unavailable anchor before suggesting stops")
  if (
    replaceIndex !== undefined &&
    (!draft.slots[replaceIndex] || draft.slots[replaceIndex].anchor)
  )
    throw new Failure(400, "Choose a non-anchor slot to replace")
  const used = new Set<string>([
    anchor.id,
    ...(replaceIndex === undefined
      ? []
      : draft.slots.flatMap((s) => (s.placeId ? [s.placeId] : []))),
  ])
  const candidates = places
    .filter((p) => distance(anchor.location, p.location) <= draft.filters.radiusKm * 1000)
    .sort(
      (a, b) =>
        distance(anchor.location, a.location) - distance(anchor.location, b.location) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  return {
    ...draft,
    slots: draft.slots.map((s, i) => {
      if (s.anchor || (replaceIndex !== undefined && i !== replaceIndex)) return s
      const p = candidates.find((p) => p.category === s.category && !used.has(p.id))
      if (p) used.add(p.id)
      return { ...s, placeId: p?.id ?? null }
    }),
  }
}
export async function execute(
  operation: keyof typeof schemas,
  raw: unknown,
  ctx: Context,
): Promise<any> {
  if (!ctx.ownerId) throw new Failure(401, "Sign in to use Day Out")
  const parsed = schemas[operation].safeParse(raw)
  if (!parsed.success) throw new Failure(400, parsed.error.issues.map((i) => i.message).join("; "))
  const args = parsed.data as any
  const search = async (filter: unknown): Promise<Place[]> =>
    (await host(ctx, "/api/search", filter)).map((h: any) => h.place)
  if (operation === "suggest_outing") {
    const all = await search({})
    const anchor = all.find((p) => p.id === args.draft.slots.find((s: any) => s.anchor)?.placeId)
    if (!anchor) throw new Failure(400, "Replace the unavailable anchor before suggesting stops")
    const candidates = await search({ ...args.draft.filters, near: anchor.location })
    const draft = suggest(
      args.draft,
      [anchor, ...candidates.filter((p) => p.id !== anchor.id)],
      args.replaceIndex,
    )
    return {
      draft,
      places: Object.fromEntries(
        all.filter((p) => draft.slots.some((s) => s.placeId === p.id)).map((p) => [p.id, p]),
      ),
    }
  }
  mkdirSync(ctx.dataDir, { recursive: true })
  const db = new DatabaseSync(join(ctx.dataDir, "day-out.sqlite"))
  try {
    db.exec(
      "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS outings(id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS outing_owner ON outings(owner); CREATE TABLE IF NOT EXISTS requests(owner TEXT NOT NULL,id TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner,id));",
    )
    const read = (id: string) => {
      const row = db.prepare("SELECT body FROM outings WHERE id=? AND owner=?").get(id, ctx.ownerId)
      if (!row) throw new Failure(404, "Outing not found")
      return JSON.parse(row.body as string)
    }
    const hydrate = async (o: any) => {
      const places = await search({})
      return {
        ...o,
        places: Object.fromEntries(
          places
            .filter((p) => o.draft.slots.some((s: any) => s.placeId === p.id))
            .map((p) => [p.id, p]),
        ),
      }
    }
    if (operation === "get_outing") return await hydrate(read(args.id))
    if (operation === "list_outings") {
      const rows = db
        .prepare("SELECT body FROM outings WHERE owner=? ORDER BY rowid DESC")
        .all(ctx.ownerId)
      return rows.map((r) => JSON.parse(r.body as string))
    }
    const input = JSON.stringify({ operation, ...args })
    const retry = db
      .prepare("SELECT input,result FROM requests WHERE owner=? AND id=?")
      .get(ctx.ownerId, args.requestId)
    if (retry) {
      if (retry.input !== input)
        throw new Failure(409, "Request ID already used for another operation")
      return JSON.parse(retry.result as string)
    }
    const accessible =
      operation === "save_outing" ? new Set((await search({})).map((p) => p.id)) : new Set<string>()
    db.exec("BEGIN IMMEDIATE")
    try {
      const concurrent = db
        .prepare("SELECT input,result FROM requests WHERE owner=? AND id=?")
        .get(ctx.ownerId, args.requestId)
      if (concurrent) {
        if (concurrent.input !== input)
          throw new Failure(409, "Request ID already used for another operation")
        db.exec("COMMIT")
        return JSON.parse(concurrent.result as string)
      }
      const previous = args.id ? read(args.id) : undefined
      if (previous && previous.revision !== args.expectedRevision)
        throw new Failure(409, "Outing changed. Reload before saving or deleting.")
      let result: any
      if (operation === "delete_outing") {
        db.prepare("DELETE FROM outings WHERE id=? AND owner=?").run(args.id, ctx.ownerId)
        result = { id: args.id, deleted: true }
      } else {
        const draft = args.draft as Draft
        for (const s of draft.slots) {
          if (!s.placeId) throw new Failure(400, "Fill or remove empty slots before saving")
          if (
            !accessible.has(s.placeId) &&
            !previous?.draft.slots.some(
              (old: any) =>
                old.placeId === s.placeId && old.anchor === s.anchor && old.category === s.category,
            )
          )
            throw new Failure(403, "Selected place is unavailable")
        }
        const now = new Date().toISOString()
        result = {
          id: args.id ?? randomUUID(),
          draft,
          revision: (previous?.revision ?? 0) + 1,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        }
        db.prepare(
          "INSERT INTO outings VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
        ).run(result.id, ctx.ownerId, JSON.stringify(result))
      }
      db.prepare("INSERT INTO requests VALUES(?,?,?,?)").run(
        ctx.ownerId,
        args.requestId,
        input,
        JSON.stringify(result),
      )
      db.exec("COMMIT")
      return result
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
  } finally {
    db.close()
  }
}
