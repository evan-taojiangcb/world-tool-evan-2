import { test, expect } from "@playwright/test";

test.describe("Word Tool Extension", () => {
  test("placeholder e2e spec", async ({ page }) => {
    await page.setContent("<p>apple good morning example</p>");
    await page.dblclick("text=apple");
    expect(true).toBeTruthy();
  });
});
