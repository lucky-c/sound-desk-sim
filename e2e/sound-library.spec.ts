import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const FIXTURE = fileURLToPath(new URL('./fixtures/test-tone.wav', import.meta.url))
const SHOTS = fileURLToPath(new URL('./__screenshots__/', import.meta.url))

/** Fail the flow if the app logs any console error or throws. */
function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

test('loads the desk', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sound Desk Sim' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SHOTS}01-desk.png` })
  expect(errors).toEqual([])
})

test('upload a sound, plug it in, and play', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')
  await page.waitForTimeout(800)

  // Open the Sound Library and upload the fixture.
  await page.getByRole('button', { name: 'Sounds' }).click()
  await page.locator('input[type=file]').setInputFiles(FIXTURE)
  await page.locator('input[placeholder=Name]').fill('Test Tone')
  await page.screenshot({ path: `${SHOTS}02-upload-form.png` })
  await page.getByRole('button', { name: /Add to library/ }).click()

  // It should now appear in the library list.
  await expect(page.locator('span', { hasText: /^Test Tone$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Sounds' }).click() // close panel

  // Plug it into the first empty channel via the picker.
  const selects = page.locator('select')
  const count = await selects.count()
  let plugged = false
  for (let i = 0; i < count; i++) {
    if ((await selects.nth(i).inputValue()) === '') {
      await selects.nth(i).selectOption({ label: 'Test Tone' })
      plugged = true
      break
    }
  }
  expect(plugged).toBe(true)

  // A performer for the upload should appear, and Play should start it.
  await page.getByRole('button', { name: 'Play' }).click()
  // Building the graph + decoding the upload can take a moment on CI; the
  // transport flips to Pause once playback is actually running.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}03-plugged-playing.png` })

  expect(errors).toEqual([])
})
