import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
test("capture marketing previews from installed modules", async ({ page, baseURL }) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 1440, height: 1050 })
  const headers = { origin: baseURL! }
  const setup = await (await page.request.get("/api/setup")).json()
  expect(
    (
      await page.request.post(`/api/auth/${setup.signupOpen ? "sign-up" : "sign-in"}/email`, {
        headers,
        data: {
          name: "Placard demo",
          email: "gallery@example.com",
          password: "correct horse battery",
        },
      })
    ).ok(),
  ).toBeTruthy()
  for (const [id, version] of [
    ["day-out", "0.1.1"],
    ["board", "0.2.0"],
    ["menus", "0.2.0"],
    ["pick", "0.2.1"],
  ]) {
    const r = await page.request.post("/api/modules/upload", {
      headers,
      data: {
        filename: `places.${id}.zip`,
        contentBase64: readFileSync(`../places.${id}/dist/places.${id}-${version}.zip`).toString(
          "base64",
        ),
      },
    })
    expect(r.ok(), await r.text()).toBeTruthy()
  }
  const names = [
    "Maison des Arts",
    "Café des Jardins",
    "La Table du Parc",
    "Le Petit Atelier",
    "Parc du Cinquantenaire",
    "Musée des Lumières",
    "Café Botanique",
    "Les Trois Tilleuls",
    "Galerie du Passage",
    "Jardin des Saisons",
    "Le Comptoir",
    "Cinéma Lumière",
    "Maison Horta",
    "La Buvette",
    "Parc Léopold",
    "Atelier du Pain",
    "Musée de la Ville",
    "Les Serres",
    "La Terrasse",
    "Le Jardin Secret",
    "Café Central",
    "Le Botanique",
    "Place des Fleurs",
    "La Belle Époque",
  ]
  const places: any[] = []
  for (let i = 0; i < names.length; i++) {
    const category = (
      [
        "museum",
        "cafe",
        "restaurant",
        "other",
        "park",
        "museum",
        "cafe",
        "restaurant",
        "museum",
        "park",
        "restaurant",
        "cinema",
        "museum",
        "bar",
        "park",
        "cafe",
        "museum",
        "park",
        "restaurant",
        "park",
        "cafe",
        "museum",
        "park",
        "restaurant",
      ] as const
    )[i]
    const r = await page.request.post("/api/places/manual", {
      headers,
      data: {
        name: names[i],
        category,
        location: { lat: 50.84 + i * 0.0007, lng: 4.35 + i * 0.0003 },
        address: `${12 + i} Rue des Jardins, Bruxelles`,
      },
    })
    expect(r.ok()).toBeTruthy()
    places.push((await r.json()).place)
  }
  const menu = await page.request.post("/api/m/places.menus/save_menu", {
    headers,
    data: {
      placeId: places[2].id,
      requestId: crypto.randomUUID(),
      menu: {
        name: "Seasonal kitchen",
        currency: "EUR",
        sections: [
          {
            name: "To begin",
            items: [
              {
                name: "Roasted tomato soup",
                description: "Basil oil, sourdough toast",
                price: "9.00",
              },
              {
                name: "Burrata & garden tomatoes",
                description: "Fresh herbs, olive oil",
                price: "14.00",
              },
            ],
          },
          {
            name: "From the kitchen",
            items: [
              { name: "Sea bass", description: "Lemon butter, seasonal greens", price: "26.00" },
              {
                name: "Wild mushroom risotto",
                description: "Aged parmesan, thyme",
                price: "22.00",
              },
            ],
          },
        ],
      },
    },
  })
  expect(menu.ok(), await menu.text()).toBeTruthy()
  async function open(path: string) {
    await page.goto("/")
    await page.getByRole("navigation", { name: "Main", exact: true }).waitFor({ state: "attached" })
    await page.evaluate((path) => {
      history.pushState({}, "", path)
      dispatchEvent(new PopStateEvent("popstate"))
    }, path)
    await page.locator("h1").last().waitFor()
    await page.evaluate(() => document.fonts.ready)
  }
  await open("/m/places.day-out")
  await page.getByRole("button", { name: "New outing", exact: true }).click()
  await page.getByLabel("Search your library").fill(names[0])
  await page.getByRole("button", { name: "Search places" }).click()
  await page.getByRole("button", { name: `${names[0]} · museum` }).click()
  await page.getByRole("button", { name: "Suggest stops", exact: true }).click()
  await expect(page.getByRole("heading", { name: names[1], exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Save outing", exact: true }).click()
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible()
  await page.locator("h1").click()
  await page.screenshot({ path: "test-results/marketing-day-out.png", fullPage: true })
  await open("/m/places.board")
  await page.getByRole("button", { name: "Create board", exact: true }).click()
  await page.getByRole("button", { name: "Auto-fill 22 places" }).click()
  await expect(page.getByLabel("Printed label")).toHaveCount(22)
  await page.getByLabel("Board title").fill("A little tour of Brussels")
  for (let i = 0; i < 22; i++) {
    const input = page.getByLabel("Printed label").nth(i)
    await input.fill((await input.inputValue()).slice(0, 13))
  }
  await page.getByRole("button", { name: "Save board", exact: true }).click()
  await expect(page.getByText("Board saved.", { exact: true })).toBeVisible()
  await page.locator("h1").click()
  await page.setViewportSize({ width: 1440, height: 1400 })
  await page.screenshot({ path: "test-results/marketing-board.png" })
  await page.setViewportSize({ width: 1440, height: 1050 })
  await open(`/places/${places[2].id}`)
  const menus = page.getByRole("region", { name: "Menus", exact: true })
  await expect(menus.getByText("Sea bass", { exact: true })).toBeVisible()
  await menus.scrollIntoViewIfNeeded()
  await page.screenshot({ path: "test-results/marketing-menus.png" })
  await open("/m/places.pick")
  await page.getByLabel("Open tonight").uncheck()
  await page.getByRole("button", { name: "Choose for me", exact: true }).click()
  await expect(page.getByRole("button", { name: "Choose for me", exact: true })).toBeEnabled()
  await page.screenshot({ path: "test-results/marketing-pick.png" })
})
