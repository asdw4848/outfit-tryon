export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const SUPPORTED_MODELS = [
  {
    id: 'gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image（快速・推薦）',
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image Preview（高畫質細節）',
  },
];

const TARGET_AREA_INSTRUCTIONS = {
  full: 'Replace the person’s entire outfit (top and bottom, or dress/suit) with the complete outfit shown in the second image.',
  top: 'Replace only the person’s upper-body garment (shirt, blouse, sweater, or top) with the top shown in the second image, keeping their original pants/skirt and shoes.',
  bottom: 'Replace only the person’s lower-body garment (pants, jeans, shorts, or skirt) with the bottom garment shown in the second image, keeping their original top.',
  outerwear: 'Layer the jacket, coat, or outerwear from the second image naturally over the person’s current clothing.',
  dress: 'Replace the person’s clothing with the dress or jumpsuit shown in the second image.',
};

const FIT_STYLE_INSTRUCTIONS = {
  natural: 'Match the garment’s natural drape, realistic folds, and proportional fit on the person’s body.',
  tailored: 'Give the garment a clean, tailored, well-fitted silhouette on the person’s frame.',
  relaxed: 'Keep a slightly relaxed, oversized, casual drape while remaining realistic.',
};

/**
 * Parses and validates a base64 image data URL.
 */
export function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('圖片格式無效：必須為 Data URL 字串。');
  }
  const match = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('圖片格式無效：無法解析 Base64 Data URL。');
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`不支援的圖片格式 (${mimeType})，請使用 JPG、PNG 或 WebP。`);
  }
  return { mimeType, data: match[2] };
}

/**
 * Builds a structured virtual try-on prompt for Gemini multimodal image editing.
 */
export function buildTryOnPrompt({
  targetArea = 'full',
  fitStyle = 'natural',
  preserveBackground = true,
  extraNotes = '',
} = {}) {
  const areaInstruction =
    TARGET_AREA_INSTRUCTIONS[targetArea] ?? TARGET_AREA_INSTRUCTIONS.full;
  const fitInstruction =
    FIT_STYLE_INSTRUCTIONS[fitStyle] ?? FIT_STYLE_INSTRUCTIONS.natural;

  const lines = [
    'Perform a realistic virtual try-on edit.',
    'Image 1 is the target person photo. Image 2 is the outfit reference image.',
    areaInstruction,
    fitInstruction,
    'Strictly preserve the person’s identity, face, facial expression, skin tone, hair, body proportions, and pose from Image 1.',
    preserveBackground
      ? 'Keep the exact original background, camera framing, and ambient lighting from Image 1 unchanged.'
      : 'Harmonize lighting and shadows cleanly around the subject while keeping the person recognizable.',
    'Ensure fabric texture, seams, patterns, collar/sleeves, shadows, and natural wrinkles blend photorealistically with Image 1’s lighting.',
    'Do not include watermarks, extra limbs, distorted hands, or artifacts.',
  ];

  const trimmedNotes = typeof extraNotes === 'string' ? extraNotes.trim() : '';
  if (trimmedNotes) {
    lines.push(`Additional styling instructions: ${trimmedNotes.slice(0, 500)}`);
  }

  return lines.join('\n');
}

/**
 * Extracts generated image and optional text note from Gemini generateContent response.
 */
export function extractGeminiImage(apiResponse) {
  if (apiResponse?.error) {
    const errMsg = apiResponse.error.message || 'Gemini API 回傳錯誤。';
    throw new Error(errMsg);
  }

  const candidate = apiResponse?.candidates?.[0];
  if (!candidate) {
    const blockReason = apiResponse?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`請求未通過安全檢查 (${blockReason})，請更換圖片或調整描述後再試。`);
    }
    throw new Error('AI 未回傳任何生成結果，請稍後再試。');
  }

  const parts = candidate.content?.parts ?? [];
  let text = '';
  let imagePart = null;

  for (const part of parts) {
    if (part.text) {
      text = text ? `${text}\n${part.text}` : part.text;
    }
    const inline = part.inlineData || part.inline_data;
    if (inline?.data && !imagePart) {
      imagePart = {
        mimeType: inline.mimeType || inline.mime_type || 'image/png',
        data: inline.data,
      };
    }
  }

  if (!imagePart) {
    const reason = candidate.finishReason ? ` (${candidate.finishReason})` : '';
    throw new Error(
      `模型未產生圖片${reason}${text ? `：${text}` : '，建議更換清晰正面照片或改用其他模型。'}`
    );
  }

  return {
    mimeType: imagePart.mimeType,
    base64Data: imagePart.data,
    text,
  };
}

/**
 * Calls the Gemini REST API to synthesize the outfit onto the person photo.
 * Works in both Node.js and browser environments.
 */
export async function synthesizeWithGemini({
  apiKey,
  model = 'gemini-2.5-flash-image',
  personImage,
  outfitImage,
  options = {},
  fetchImpl = globalThis.fetch.bind(globalThis),
}) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('缺少 Gemini API Key。請在設定欄位輸入金鑰，或於 .env 設定 GEMINI_API_KEY。');
  }

  const person = parseDataUrl(personImage);
  const outfit = parseDataUrl(outfitImage);
  const prompt = buildTryOnPrompt(options);
  const safeModel = String(model || 'gemini-2.5-flash-image').trim();

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    safeModel
  )}:generateContent`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: person.mimeType, data: person.data } },
            { inlineData: { mimeType: outfit.mimeType, data: outfit.data } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const apiErr = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gemini API 呼叫失敗：${apiErr}`);
  }

  const result = extractGeminiImage(payload);
  return {
    ...result,
    model: safeModel,
    prompt,
  };
}
