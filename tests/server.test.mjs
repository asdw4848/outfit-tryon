import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildTryOnPrompt,
  extractGeminiImage,
  parseDataUrl,
  synthesizeWithGemini,
} from '../lib/tryon.mjs';
import { createAppServer } from '../server.mjs';

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;

test('parseDataUrl parses valid images and rejects unsupported types', () => {
  const parsed = parseDataUrl(SAMPLE_PNG_DATA_URL);
  assert.equal(parsed.mimeType, 'image/png');
  assert.equal(parsed.data, SAMPLE_PNG_BASE64);

  assert.throws(() => parseDataUrl('data:image/svg+xml;base64,PHN2Zz4='), /不支援的圖片格式/);
  assert.throws(() => parseDataUrl('not-a-data-url'), /無法解析/);
});

test('buildTryOnPrompt includes target area, fit style, background rule, and extra notes', () => {
  const prompt = buildTryOnPrompt({
    targetArea: 'outerwear',
    fitStyle: 'relaxed',
    preserveBackground: true,
    extraNotes: '把袖子微捲',
  });
  assert.match(prompt, /Layer the jacket, coat, or outerwear/);
  assert.match(prompt, /relaxed, oversized/);
  assert.match(prompt, /Keep the exact original background/);
  assert.match(prompt, /把袖子微捲/);
});

test('extractGeminiImage handles inlineData, blockReason, and missing image errors', () => {
  const ok = extractGeminiImage({
    candidates: [
      {
        content: {
          parts: [
            { text: '已換上外套' },
            { inlineData: { mimeType: 'image/png', data: SAMPLE_PNG_BASE64 } },
          ],
        },
      },
    ],
  });
  assert.equal(ok.mimeType, 'image/png');
  assert.equal(ok.base64Data, SAMPLE_PNG_BASE64);
  assert.equal(ok.text, '已換上外套');

  assert.throws(
    () => extractGeminiImage({ promptFeedback: { blockReason: 'SAFETY' } }),
    /SAFETY/
  );
  assert.throws(
    () =>
      extractGeminiImage({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '無法處理' }] } }],
      }),
    /模型未產生圖片/
  );
});

test('synthesizeWithGemini calls Gemini REST endpoint with expected payload', async () => {
  let capturedUrl = '';
  let capturedInit = null;
  const mockFetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/png', data: SAMPLE_PNG_BASE64 } },
                ],
              },
            },
          ],
        };
      },
    };
  };

  const res = await synthesizeWithGemini({
    apiKey: 'test-key-123',
    model: 'gemini-2.5-flash-image',
    personImage: SAMPLE_PNG_DATA_URL,
    outfitImage: SAMPLE_PNG_DATA_URL,
    options: { targetArea: 'top' },
    fetchImpl: mockFetch,
  });

  assert.equal(
    capturedUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent'
  );
  assert.equal(capturedInit.headers['x-goog-api-key'], 'test-key-123');
  const sentBody = JSON.parse(capturedInit.body);
  assert.deepEqual(sentBody.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.equal(sentBody.contents[0].parts.length, 3);
  assert.equal(res.base64Data, SAMPLE_PNG_BASE64);
});

test('HTTP server serves UI, validates API key, saves outputs, and manages history', async () => {
  const tempOutputs = fs.mkdtempSync(path.join(os.tmpdir(), 'vto-test-'));
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const server = createAppServer({
    outputsDir: tempOutputs,
    synthesizeFn: async () => ({
      mimeType: 'image/png',
      base64Data: SAMPLE_PNG_BASE64,
      text: '合成成功',
      model: 'gemini-2.5-flash-image',
    }),
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health & static HTML
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.hasServerApiKey, false);

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /AI 虛擬試穿工作室/);

    // 2. Missing API key returns 400
    const noKeyRes = await fetch(`${baseUrl}/api/tryon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personImage: SAMPLE_PNG_DATA_URL,
        outfitImage: SAMPLE_PNG_DATA_URL,
      }),
    });
    assert.equal(noKeyRes.status, 400);

    // 3. Successful try-on writes file and returns imageDataUrl
    const okRes = await fetch(`${baseUrl}/api/tryon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'demo-key',
        personImage: SAMPLE_PNG_DATA_URL,
        outfitImage: SAMPLE_PNG_DATA_URL,
        options: { targetArea: 'full' },
      }),
    });
    assert.equal(okRes.status, 200);
    const okJson = await okRes.json();
    assert.equal(okJson.imageDataUrl, SAMPLE_PNG_DATA_URL);
    assert.ok(okJson.savedFile.name.endsWith('.png'));

    // 4. List & serve & delete output
    const listRes = await fetch(`${baseUrl}/api/outputs`);
    const listJson = await listRes.json();
    assert.equal(listJson.items.length, 1);

    const imgRes = await fetch(`${baseUrl}${okJson.savedFile.url}`);
    assert.equal(imgRes.status, 200);

    const delRes = await fetch(
      `${baseUrl}/api/outputs/${encodeURIComponent(okJson.savedFile.name)}`,
      { method: 'DELETE' }
    );
    assert.equal(delRes.status, 200);

    const listAfter = await (await fetch(`${baseUrl}/api/outputs`)).json();
    assert.equal(listAfter.items.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempOutputs, { recursive: true, force: true });
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
  }
});
