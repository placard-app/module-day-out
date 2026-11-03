import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
test("installed Day Out supports an editable private outing on desktop and mobile", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180000)
  const headers = { origin: baseURL! }
  const setup = await (await page.request.get("/api/setup")).json()
  expect(
    (
      await page.request.post(`/api/auth/${setup.signupOpen ? "sign-up" : "sign-in"}/email`, {
        headers,
        data: {
          name: "Day Out tester",
          email: "day-out@example.com",
          password: "correct horse battery",
        },
      })
    ).ok(),
  ).toBeTruthy()
  const install = await page.request.post("/api/modules/upload", {
    headers,
    data: {
      filename: "places.day-out.zip",
      contentBase64: readFileSync("dist/places.day-out-0.1.0.zip").toString("base64"),
    },
  })
  expect(install.ok(), await install.text()).toBeTruthy()
  for (const [name, category] of [
    ["Anchor museum", "museum"],
    ["Coffee one", "cafe"],
    ["Coffee two", "cafe"],
    ["Dinner", "restaurant"],
  ])
    expect(
      (
        await page.request.post("/api/places/manual", {
          headers,
          data: { name, category, location: { lat: 50.85, lng: 4.35 }, address: null },
        })
      ).ok(),
    ).toBeTruthy()
  await page.goto("/")
  await page.getByRole("navigation", { name: "Main", exact: true }).waitFor({ state: "attached" })
  await page.evaluate(() => {
    history.pushState({}, "", "/m/places.day-out")
    dispatchEvent(new PopStateEvent("popstate"))
  })
  await page.getByRole("button", { name: "New outing", exact: true }).click()
  await page.getByLabel("Search your library").fill("Anchor museum")
  await page.getByRole("button", { name: "Search places" }).click()
  await page.getByRole("button", { name: "Anchor museum · museum" }).click()
  await page.getByRole("button", { name: "Suggest stops", exact: true }).click()
  await expect(page.getByRole("heading", { name: /1\. Coffee/ })).toBeVisible()
  const first = await page.getByRole("heading", { name: /1\. Coffee/ }).textContent()
  await page.getByRole("button", { name: "Replace suggestion", exact: true }).first().click()
  await expect(page.getByRole("heading", { name: /1\. Coffee/ })).not.toHaveText(first!)
  await page.getByRole("button", { name: "Move stop 1 down", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "1. Anchor museum · Anchor" })).toBeVisible()
  await expect(page.getByText(/km straight-line/).first()).toBeVisible()
  await page.getByText("Stored opening hours", { exact: true }).first().click()
  await expect(page.getByText(/Opening hours unavailable/).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Navigate" }).first()).toHaveAttribute(
    "href",
    /google.com\/maps\/dir/,
  )
  await page.getByRole("button", { name: "Save outing", exact: true }).click()
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: "test-results/day-out-mobile.png", fullPage: true })
  await page.getByRole("button", { name: "Back to outings" }).click()
  await page.getByRole("button", { name: /Open Day out around/ }).click()
  await expect(page.getByRole("heading", { name: "1. Anchor museum · Anchor" })).toBeVisible()
  await page.getByLabel("Outing title").fill("Changed")
  page.once("dialog", (d) => d.dismiss())
  await page.getByRole("button", { name: "Back to outings" }).click()
  await expect(page.getByLabel("Outing title")).toHaveValue("Changed")
  page.once("dialog", (d) => d.accept())
  await page.getByRole("button", { name: "Delete outing", exact: true }).click()
  await expect(page.getByText(/No saved outings/)).toBeVisible()
})
