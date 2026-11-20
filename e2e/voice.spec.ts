// One real voice call through the deployed setup: browser -> Agora (RTC + RTM)
// -> Conversational AI agent -> custom LLM (CUSTOM_LLM_URL = the Tatva server)
// -> Murf Falcon TTS. Chrome's fake microphone supplies audio; the question is
// sent as text over RTM, so Pooja answers it through the custom LLM.
// Read-only question: nothing is emailed or posted.
import { expect, test } from '@playwright/test';
import { login, watch } from './helpers';

test('voice call: greeting, one answered question, hang up', async ({ page }, info) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await login(page);
  await page.goto('/talk');

  const poojaCaptions = page.getByText(/· Pooja$/);
  await page.getByRole('button', { name: 'Start conversation' }).first().click();
  await expect(page.getByRole('button', { name: /End conversation/ })).toBeVisible({ timeout: 45_000 });

  // Greeting from the agent (set in /api/invite-agent).
  await expect(poojaCaptions.first()).toBeVisible({ timeout: 45_000 });
  const greeting = await page.locator('p.text-secondary-fixed').first().innerText();
  info.annotations.push({ type: 'greeting', description: greeting });
  expect(greeting).toMatch(/Pooja/i);

  // A question answered by the custom LLM (RAG + tools on the Tatva server).
  const before = await poojaCaptions.count();
  const box = page.getByPlaceholder('Ask or reply to Pooja...');
  await box.fill("What's still pending?");
  await box.press('Enter');
  await expect(page.getByText(/· You( \(typed\))?$/).last()).toBeVisible();
  await expect.poll(async () => poojaCaptions.count(), { timeout: 60_000 }).toBeGreaterThan(before);
  // Wait for the reply to finish streaming.
  await expect(page.getByText('Speaking')).toHaveCount(0, { timeout: 45_000 });
  const answer = await page.locator('p.text-secondary-fixed').last().innerText();
  info.annotations.push({ type: 'answer', description: answer });
  expect(answer.length).toBeGreaterThan(20);
  expect(answer).not.toMatch(/sorry|went wrong|can't reach|trouble/i);

  // The live timeline shows the tool the server ran for that answer.
  await expect(page.getByText(/open items|pending|Checked/i).first()).toBeVisible();

  await page.getByRole('button', { name: /End conversation/ }).click();
  await expect(page.getByRole('button', { name: 'Start conversation' }).first()).toBeVisible({ timeout: 20_000 });
  console.log(`greeting: ${greeting}\nanswer: ${answer}`);
  expect(problems.filter((p) => !/agora|rtm|websocket|webrtc/i.test(p))).toEqual([]);
});
