import { z } from "zod"
export const categories = [
  "restaurant",
  "cafe",
  "bar",
  "park",
  "museum",
  "cinema",
  "hotel",
  "trail",
  "other",
] as const
const id = z.string().min(1).max(200)
export const slotSchema = z
  .object({ category: z.enum(categories), placeId: id.nullable(), anchor: z.boolean() })
  .strict()
export const draftSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slots: z.array(slotSchema).min(1).max(8),
    filters: z
      .object({
        radiusKm: z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10), z.literal(25)]),
        list: id.optional(),
        tag: id.optional(),
        status: z.literal("want_to_go").optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.slots.filter((s) => s.anchor).length !== 1)
      c.addIssue({ code: "custom", message: "Exactly one anchor is required" })
    const ids = v.slots.flatMap((s) => (s.placeId ? [s.placeId] : []))
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "Places must be unique" })
  })
export const schemas = {
  suggest_outing: z
    .object({ draft: draftSchema, replaceIndex: z.number().int().min(0).max(7).optional() })
    .strict(),
  list_outings: z.object({}).strict(),
  get_outing: z.object({ id }).strict(),
  save_outing: z
    .object({
      draft: draftSchema,
      id: id.optional(),
      expectedRevision: z.number().int().positive().optional(),
      requestId: z.string().uuid(),
    })
    .strict()
    .refine(
      (v) => Boolean(v.id) === (v.expectedRevision !== undefined),
      "Updates require id and expectedRevision",
    ),
  delete_outing: z
    .object({ id, expectedRevision: z.number().int().positive(), requestId: z.string().uuid() })
    .strict(),
}
export type Draft = z.infer<typeof draftSchema>
export type Place = {
  id: string
  name: string
  category: (typeof categories)[number]
  location: { lat: number; lng: number }
  address: string | null
  coverThumbUrl?: string | null
  facts?: {
    openingHours?: {
      weekdayDescriptions?: string[]
      periods?: {
        open: { day: number; hour: number; minute: number }
        close?: { day: number; hour: number; minute: number }
      }[]
    } | null
    fromGoogle?: boolean
  }
}
export type Outing = {
  id: string
  draft: Draft
  revision: number
  createdAt: string
  updatedAt: string
  places: Record<string, Place>
}
export function distance(a: Place["location"], b: Place["location"]) {
  const r = Math.PI / 180
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}
