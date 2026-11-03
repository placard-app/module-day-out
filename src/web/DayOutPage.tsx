import { useState, useEffect } from "react"
import { categories, distance, type Draft, type Place, type Outing } from "../shared/outing.ts"
const base = "/api/m/places.day-out/"
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error ?? "Operation failed")
  return data
}
function hours(p: Place) {
  const h = p.facts?.openingHours
  if (h?.weekdayDescriptions?.length) return h.weekdayDescriptions
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const time = (t: { day: number; hour: number; minute: number }) =>
    `${days[t.day]} ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`
  return (
    h?.periods?.map(
      (v) => `${time(v.open)} – ${v.close ? time(v.close) : "No closing time recorded"}`,
    ) ?? []
  )
}
const empty: Draft = { title: "New outing", filters: { radiusKm: 5 }, slots: [] }
export function DayOutPage() {
  const [saved, setSaved] = useState<Outing[]>([]),
    [draft, setDraft] = useState<Draft | null>(null),
    [record, setRecord] = useState<Outing | null>(null),
    [places, setPlaces] = useState<Record<string, Place>>({}),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<Place[]>([]),
    [choosing, setChoosing] = useState<number | null>(null),
    [lists, setLists] = useState<{ id: string; name: string }[]>([]),
    [tags, setTags] = useState<{ name: string }[]>([])
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed")
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void run(async () => {
      setSaved(await api("outings"))
      setLists(await api("lists"))
      setTags(await api("tags"))
    })
  }, [])
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handler)
    const click = (e: MouseEvent) => {
      if (
        dirty &&
        (e.target as HTMLElement).closest("a") &&
        !window.confirm("Discard unsaved outing changes?")
      ) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener("click", click, true)
    return () => {
      window.removeEventListener("beforeunload", handler)
      document.removeEventListener("click", click, true)
    }
  }, [dirty])
  function leave() {
    return !dirty || window.confirm("Discard unsaved outing changes?")
  }
  function edit(d: Draft) {
    setDraft(d)
    setDirty(true)
  }
  function choose(p: Place) {
    setPlaces((v) => ({ ...v, [p.id]: p }))
    if (!draft || !draft.slots.length) {
      edit({
        ...empty,
        title: `Day out around ${p.name}`,
        slots: [
          { category: "cafe", placeId: null, anchor: false },
          { category: p.category, placeId: p.id, anchor: true },
          { category: "restaurant", placeId: null, anchor: false },
        ],
      })
    } else if (choosing !== null) {
      edit({
        ...draft,
        slots: draft.slots.map((s, i) =>
          i === choosing ? { ...s, category: p.category, placeId: p.id } : s,
        ),
      })
    }
    setChoosing(null)
    setHits([])
    setQuery("")
  }
  async function generate(index?: number) {
    if (!draft) return
    const data = await api("suggest", "POST", {
      draft,
      ...(index === undefined ? {} : { replaceIndex: index }),
    })
    edit(data.draft)
    setPlaces(data.places)
  }
  function move(i: number, delta: number) {
    if (!draft) return
    const slots = [...draft.slots]
    ;[slots[i], slots[i + delta]] = [slots[i + delta], slots[i]]
    edit({ ...draft, slots })
  }
  return (
    <main className="day-out">
      <style>{`.day-out{max-width:920px;margin:auto;padding:24px;color:inherit}.day-out button,.day-out input,.day-out select{font:inherit;padding:9px 12px;border:1px solid #8b9b95;border-radius:8px;background:var(--card,#fff);color:#183d32}.day-out button{cursor:pointer}.day-out button:disabled{opacity:.45;cursor:default}.day-out .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}.day-out article{border:1px solid #8b9b9560;border-radius:14px;padding:18px;margin:16px 0}.day-out img{width:100%;max-height:200px;object-fit:cover;border-radius:10px}.day-out a{color:inherit;text-decoration:underline}.day-out label{display:grid;gap:5px}.day-out .muted{opacity:.7}.day-out h1{font-size:32px}.day-out h2{font-size:22px}.day-out input{max-width:100%;box-sizing:border-box}.day-out button:focus-visible,.day-out a:focus-visible{outline:3px solid #d99f24;outline-offset:3px}`}</style>
      <h1>Day Out</h1>
      <p>Build an outing around a place you love.</p>
      {error && <p role="alert">{error}</p>}
      <div className="row">
        <button
          disabled={busy}
          onClick={() => {
            if (leave()) {
              setDraft({ ...empty })
              setRecord(null)
              setPlaces({})
              setDirty(false)
              setChoosing(null)
              setHits([])
            }
          }}
        >
          New outing
        </button>
        {draft && (
          <button
            disabled={busy}
            onClick={() => {
              if (leave()) {
                setDraft(null)
                setDirty(false)
                setRecord(null)
              }
            }}
          >
            Back to outings
          </button>
        )}
      </div>
      {!draft ? (
        saved.length ? (
          saved.map((o) => (
            <article key={o.id}>
              <h2>{o.draft.title}</h2>
              <p>{o.draft.slots.length} stops</p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const data = await api(`outings/${o.id}`)
                    setRecord(data)
                    setDraft(data.draft)
                    setPlaces(data.places)
                    setDirty(false)
                  })
                }
              >
                Open {o.draft.title}
              </button>
            </article>
          ))
        ) : (
          <p>No saved outings yet. Choose New outing to begin.</p>
        )
      ) : (
        <>
          {(draft.slots.length === 0 || choosing !== null) && (
            <section aria-label="Choose a place">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(async () =>
                    setHits(
                      (await api("search", "POST", query.trim() ? { text: query.trim() } : {})).map(
                        (h: any) => h.place,
                      ),
                    ),
                  )
                }}
              >
                <label>
                  Search your library
                  <input value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <button disabled={busy}>Search places</button>
              </form>
              {hits
                .filter((p) => !draft.slots.some((s) => s.placeId === p.id))
                .map((p) => (
                  <p key={p.id}>
                    <button disabled={busy} onClick={() => choose(p)}>
                      {p.name} · {p.category}
                    </button>
                  </p>
                ))}
            </section>
          )}
          {draft.slots.length > 0 && (
            <>
              <label>
                Outing title
                <input
                  value={draft.title}
                  onChange={(e) => edit({ ...draft, title: e.target.value })}
                />
              </label>
              <div className="row">
                <label>
                  Radius
                  <select
                    value={draft.filters.radiusKm}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        filters: {
                          ...draft.filters,
                          radiusKm: Number(e.target.value) as Draft["filters"]["radiusKm"],
                        },
                      })
                    }
                  >
                    {[1, 2, 5, 10, 25].map((n) => (
                      <option key={n} value={n}>
                        {n} km
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  List
                  <select
                    value={draft.filters.list ?? ""}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        filters: { ...draft.filters, list: e.target.value || undefined },
                      })
                    }
                  >
                    <option value="">All lists</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tag
                  <select
                    value={draft.filters.tag ?? ""}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        filters: { ...draft.filters, tag: e.target.value || undefined },
                      })
                    }
                  >
                    <option value="">All tags</option>
                    {tags.map((t) => (
                      <option key={t.name}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!draft.filters.status}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        filters: {
                          ...draft.filters,
                          status: e.target.checked ? "want_to_go" : undefined,
                        },
                      })
                    }
                  />
                  Want to go only
                </label>
              </div>
              <p className="muted">
                Filters apply when requesting suggestions. The anchor stays selected.
              </p>
              <button disabled={busy} onClick={() => void run(() => generate())}>
                Suggest stops
              </button>
              {draft.slots.map((s, i) => {
                const p = s.placeId ? places[s.placeId] : undefined,
                  prev = i ? places[draft.slots[i - 1].placeId ?? ""] : undefined
                return (
                  <article key={i} aria-label={`Stop ${i + 1}`}>
                    <h2>
                      {i + 1}. {p?.name ?? (s.placeId ? "Place unavailable" : "No matching place")}
                      {s.anchor ? " · Anchor" : ""}
                    </h2>
                    {p ? (
                      <>
                        {p.coverThumbUrl && <img src={p.coverThumbUrl} alt="" />}
                        <p>
                          {p.category} · {p.address ?? "Address unavailable"}
                        </p>
                        {prev && (
                          <p>
                            {(distance(prev.location, p.location) / 1000).toFixed(2)} km
                            straight-line from previous stop
                          </p>
                        )}
                        <details>
                          <summary>Stored opening hours</summary>
                          {hours(p).length ? (
                            hours(p).map((line) => <p key={line}>{line}</p>)
                          ) : (
                            <p>Opening hours unavailable. Check the place before visiting.</p>
                          )}
                        </details>
                        {p.facts?.fromGoogle && <small>Place information from Google Maps</small>}
                        <div className="row">
                          <a href={`/places/${encodeURIComponent(p.id)}`}>Place details</a>
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.location.lat},${p.location.lng}`)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Navigate
                          </a>
                        </div>
                      </>
                    ) : (
                      <p>Change category, widen the radius, choose a place or remove this stop.</p>
                    )}
                    <div className="row">
                      {!s.anchor && (
                        <label>
                          Category
                          <select
                            value={s.category}
                            onChange={(e) =>
                              edit({
                                ...draft,
                                slots: draft.slots.map((v, j) =>
                                  j === i
                                    ? {
                                        ...v,
                                        category: e.target.value as typeof s.category,
                                        placeId: null,
                                      }
                                    : v,
                                ),
                              })
                            }
                          >
                            {categories.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => {
                          setChoosing(i)
                          setHits([])
                        }}
                      >
                        Choose {s.anchor ? "anchor" : "place"}
                      </button>
                      {!s.anchor && (
                        <button disabled={busy} onClick={() => void run(() => generate(i))}>
                          Replace suggestion
                        </button>
                      )}
                      <button
                        disabled={busy || i === 0}
                        aria-label={`Move stop ${i + 1} up`}
                        onClick={() => move(i, -1)}
                      >
                        ↑ Up
                      </button>
                      <button
                        disabled={busy || i === draft.slots.length - 1}
                        aria-label={`Move stop ${i + 1} down`}
                        onClick={() => move(i, 1)}
                      >
                        ↓ Down
                      </button>
                      {!s.anchor && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            edit({ ...draft, slots: draft.slots.filter((_, j) => i !== j) })
                          }
                        >
                          Remove stop
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
              <div className="row">
                <button
                  disabled={busy || draft.slots.length >= 8}
                  onClick={() =>
                    edit({
                      ...draft,
                      slots: [...draft.slots, { category: "park", placeId: null, anchor: false }],
                    })
                  }
                >
                  Add stop
                </button>
                <button
                  disabled={busy || !dirty || draft.slots.some((s) => !s.placeId)}
                  onClick={() =>
                    void run(async () => {
                      const data = await api(
                        record ? `outings/${record.id}` : "outings",
                        record ? "PUT" : "POST",
                        {
                          draft,
                          requestId: crypto.randomUUID(),
                          ...(record ? { expectedRevision: record.revision } : {}),
                        },
                      )
                      setRecord({ ...data, places })
                      setDraft(data.draft)
                      setDirty(false)
                      setSaved(await api("outings"))
                    })
                  }
                >
                  Save outing
                </button>
                {record && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (leave())
                          void run(async () => {
                            const data = await api(`outings/${record.id}`)
                            setRecord(data)
                            setDraft(data.draft)
                            setPlaces(data.places)
                            setDirty(false)
                          })
                      }}
                    >
                      Reload saved outing
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Delete this outing?"))
                          void run(async () => {
                            await api(`outings/${record.id}`, "DELETE", {
                              expectedRevision: record.revision,
                              requestId: crypto.randomUUID(),
                            })
                            setDraft(null)
                            setRecord(null)
                            setDirty(false)
                            setSaved(await api("outings"))
                          })
                      }}
                    >
                      Delete outing
                    </button>
                  </>
                )}
              </div>
              {dirty && <p>Unsaved changes</p>}
            </>
          )}
        </>
      )}
    </main>
  )
}
