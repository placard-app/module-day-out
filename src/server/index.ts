import { z } from "zod"
import { schemas } from "../shared/outing.ts"
import { execute, host, Failure, type Context } from "./service.ts"
export function createModule() {
  return {
    mcpTools: Object.entries(schemas).map(([name, schema]) => ({
      def: {
        name,
        description: `${name.replaceAll("_", " ")}. Suggestions never save. Mutations require a unique requestId; reuse it only for an identical retry. Updates and deletion require expectedRevision.`,
        inputSchema: z.toJSONSchema(schema),
      },
      handler: async (args: unknown, ctx: Context) => {
        try {
          return { ok: true, data: await execute(name as keyof typeof schemas, args, ctx) }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "Operation failed" }
        }
      },
    })),
    createHttpApp: async (request: Request, ctx: Context) => {
      try {
        if (!ctx.ownerId) throw new Failure(401, "Sign in to use Day Out")
        const path = (ctx.pathSuffix ?? "").replace(/^\/+|\/+$/g, "")
        let result: unknown
        if (path === "search" && request.method === "POST")
          result = await host(ctx, "/api/search", await request.json())
        else if (path === "lists" && request.method === "GET")
          result = await host(ctx, "/api/lists")
        else if (path === "tags" && request.method === "GET") result = await host(ctx, "/api/tags")
        else if (path === "suggest" && request.method === "POST")
          result = await execute("suggest_outing", await request.json(), ctx)
        else if (path === "outings" && request.method === "GET")
          result = await execute("list_outings", {}, ctx)
        else if (path === "outings" && request.method === "POST")
          result = await execute("save_outing", await request.json(), ctx)
        else {
          const m = /^outings\/([^/]+)$/.exec(path)
          if (!m) throw new Failure(404, "Not found")
          const id = decodeURIComponent(m[1])
          if (request.method === "GET") result = await execute("get_outing", { id }, ctx)
          else if (request.method === "PUT" || request.method === "DELETE")
            result = await execute(
              request.method === "PUT" ? "save_outing" : "delete_outing",
              { ...(await request.json()), id },
              ctx,
            )
          else throw new Failure(405, "Method not allowed")
        }
        return Response.json(result, { headers: { "cache-control": "no-store" } })
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : "Operation failed" },
          {
            status: e instanceof Failure ? e.status : e instanceof SyntaxError ? 400 : 500,
            headers: { "cache-control": "no-store" },
          },
        )
      }
    },
  }
}
