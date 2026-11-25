import { SUPPORTED_MODELS, synthesizeWithGemini } from './tryon-core.js';

const STORAGE_KEY_API = 'vto_gemini_api_key';
const STORAGE_KEY_MODEL = 'vto_gemini_model';
const STORAGE_KEY_HISTORY = 'vto_local_history';

const state = {
  mode: 'ai', // 'ai' | 'manual'
  backendAvailable: false,
  hasServerApiKey: false,
  personDataUrl: null,
  outfitDataUrl: null,
  personImgEl: null,
  outfitImgEl: null,
  processedOutfitCanvas: null,
  resultDataUrl: null,
  compareSplit: 50,
  compareSingleView: false,
  manual: {
    xRatio: 0.5,
    yRatio: 0.52,
    scale: 0.55,
    rotation: 0,
    opacity: 0.96,
    brightness: 100,
    contrast: 100,
    bgTolerance: 28,
    autoRemoveBg: true,
    flipX: false,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    startXRatio: 0.5,
    startYRatio: 0.52,
  },
};

const els = {
  apiSettingsPanel: document.getElementById('apiSettingsPanel'),
  toggleApiPanelBtn: document.getElementById('toggleApiPanelBtn'),
  apiKeyStatusDot: document.getElementById('apiKeyStatusDot'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  toggleKeyVisibilityBtn: document.getElementById('toggleKeyVisibilityBtn'),
  rememberKeyCheckbox: document.getElementById('rememberKeyCheckbox'),
  modelSelect: document.getElementById('modelSelect'),
  serverKeyHint: document.getElementById('serverKeyHint'),
  loadDemoBtn: document.getElementById('loadDemoBtn'),

  personInput: document.getElementById('personInput'),
  personDropzone: document.getElementById('personDropzone'),
  personPlaceholder: document.getElementById('personPlaceholder'),
  personPreview: document.getElementById('personPreview'),
  personMeta: document.getElementById('personMeta'),
  clearPersonBtn: document.getElementById('clearPersonBtn'),
  pastePersonBtn: document.getElementById('pastePersonBtn'),

  outfitInput: document.getElementById('outfitInput'),
  outfitDropzone: document.getElementById('outfitDropzone'),
  outfitPlaceholder: document.getElementById('outfitPlaceholder'),
  outfitPreview: document.getElementById('outfitPreview'),
  outfitMeta: document.getElementById('outfitMeta'),
  clearOutfitBtn: document.getElementById('clearOutfitBtn'),
  pasteOutfitBtn: document.getElementById('pasteOutfitBtn'),

  tabAiBtn: document.getElementById('tabAiBtn'),
  tabManualBtn: document.getElementById('tabManualBtn'),
  aiModePanel: document.getElementById('aiModePanel'),
  manualModePanel: document.getElementById('manualModePanel'),

  targetAreaSelect: document.getElementById('targetAreaSelect'),
  fitStyleSelect: document.getElementById('fitStyleSelect'),
  preserveBgCheckbox: document.getElementById('preserveBgCheckbox'),
  extraNotesInput: document.getElementById('extraNotesInput'),
  runAiBtn: document.getElementById('runAiBtn'),

  manualScale: document.getElementById('manualScale'),
  manualRotate: document.getElementById('manualRotate'),
  manualBgTol: document.getElementById('manualBgTol'),
  manualOpacity: document.getElementById('manualOpacity'),
  manualBrightness: document.getElementById('manualBrightness'),
  manualContrast: document.getElementById('manualContrast'),
  autoRemoveBgCheckbox: document.getElementById('autoRemoveBgCheckbox'),
  flipOutfitBtn: document.getElementById('flipOutfitBtn'),
  resetManualBtn: document.getElementById('resetManualBtn'),
  exportManualBtn: document.getElementById('exportManualBtn'),
  scaleVal: document.getElementById('scaleVal'),
  rotateVal: document.getElementById('rotateVal'),
  bgTolVal: document.getElementById('bgTolVal'),
  opacityVal: document.getElementById('opacityVal'),
  brightVal: document.getElementById('brightVal'),
  contrastVal: document.getElementById('contrastVal'),

  resultModeBadge: document.getElementById('resultModeBadge'),
  resultEmptyState: document.getElementById('resultEmptyState'),
  manualCanvas: document.getElementById('manualCanvas'),
  compareContainer: document.getElementById('compareContainer'),
  compareBeforeImg: document.getElementById('compareBeforeImg'),
  compareAfterLayer: document.getElementById('compareAfterLayer'),
  compareAfterImg: document.getElementById('compareAfterImg'),
  compareDivider: document.getElementById('compareDivider'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  errorBanner: document.getElementById('errorBanner'),
  aiNoteBox: document.getElementById('aiNoteBox'),
  toggleCompareBtn: document.getElementById('toggleCompareBtn'),
  reuseResultBtn: document.getElementById('reuseResultBtn'),
  downloadResultBtn: document.getElementById('downloadResultBtn'),

  historyGrid: document.getElementById('historyGrid'),
  refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
};

function showError(msg) {
  if (!msg) {
    els.errorBanner.classList.add('hidden');
    els.errorBanner.textContent = '';
    return;
  }
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.remove('hidden');
}

function updateApiStatusDot() {
  const ready = state.hasServerApiKey || Boolean(els.apiKeyInput.value.trim());
  els.apiKeyStatusDot.classList.toggle('ready', ready);
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('無法載入圖片檔案。'));
    img.src = src;
  });
}

/**
 * Resizes overly large images client-side (max 1536px) to keep uploads snappy.
 */
async function fileToOptimizedDataUrl(file) {
  const rawUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('讀取檔案失敗。'));
    reader.readAsDataURL(file);
  });

  const img = await loadImageElement(rawUrl);
  const maxDim = 1536;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const targetW = Math.round(img.width * scale);
  const targetH = Math.round(img.height * scale);

  if (scale === 1 && (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp')) {
    return { dataUrl: rawUrl, width: img.width, height: img.height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const outputMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return {
    dataUrl: canvas.toDataURL(outputMime, 0.92),
    width: targetW,
    height: targetH,
  };
}

async function setSlotImage(slot, dataUrl) {
  showError('');
  const isPerson = slot === 'person';
  const imgEl = dataUrl ? await loadImageElement(dataUrl) : null;

  if (isPerson) {
    state.personDataUrl = dataUrl;
    state.personImgEl = imgEl;
    els.personPreview.src = dataUrl || '';
    els.personPreview.classList.toggle('hidden', !dataUrl);
    els.personPlaceholder.classList.toggle('hidden', Boolean(dataUrl));
    els.clearPersonBtn.classList.toggle('hidden', !dataUrl);
    els.personMeta.textContent = imgEl ? `${imgEl.width} × ${imgEl.height}` : '尚未選擇圖片';
  } else {
    state.outfitDataUrl = dataUrl;
    state.outfitImgEl = imgEl;
    state.processedOutfitCanvas = null;
    els.outfitPreview.src = dataUrl || '';
    els.outfitPreview.classList.toggle('hidden', !dataUrl);
    els.outfitPlaceholder.classList.toggle('hidden', Boolean(dataUrl));
    els.clearOutfitBtn.classList.toggle('hidden', !dataUrl);
    els.outfitMeta.textContent = imgEl ? `${imgEl.width} × ${imgEl.height}` : '尚未選擇圖片';
  }

  if (state.mode === 'manual') {
    rebuildProcessedOutfit();
    renderManualCanvas();
  }
}

function bindUploadSlot(slot, inputEl, dropzoneEl, clearBtn, pasteBtn) {
  inputEl.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { dataUrl } = await fileToOptimizedDataUrl(file);
      await setSlotImage(slot, dataUrl);
    } catch (err) {
      showError(err.message);
    } finally {
      inputEl.value = '';
    }
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove('dragover');
    });
  });

  dropzoneEl.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const { dataUrl } = await fileToOptimizedDataUrl(file);
      await setSlotImage(slot, dataUrl);
    } catch (err) {
      showError(err.message);
    }
  });

  clearBtn.addEventListener('click', () => setSlotImage(slot, null));

  pasteBtn.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.read) {
        throw new Error('此瀏覽器不支援按鈕讀取剪貼簿，請改用拖曳或檔案上傳。');
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith('image/'));
        if (imgType) {
          const blob = await item.getType(imgType);
          const { dataUrl } = await fileToOptimizedDataUrl(new File([blob], 'paste.png', { type: imgType }));
          await setSlotImage(slot, dataUrl);
          return;
        }
      }
      showError('剪貼簿內沒有找到圖片。');
    } catch (err) {
      showError(err.message || '無法讀取剪貼簿圖片，請檢查瀏覽器權限。');
    }
  });
}

function setMode(nextMode) {
  state.mode = nextMode;
  const isAi = nextMode === 'ai';
  els.tabAiBtn.classList.toggle('active', isAi);
  els.tabManualBtn.classList.toggle('active', !isAi);
  els.aiModePanel.classList.toggle('hidden', !isAi);
  els.manualModePanel.classList.toggle('hidden', isAi);
  showError('');

  if (isAi) {
    els.manualCanvas.classList.add('hidden');
    if (state.resultDataUrl) {
      els.compareContainer.classList.remove('hidden');
      els.resultEmptyState.classList.add('hidden');
      els.toggleCompareBtn.classList.toggle('hidden', !state.personDataUrl);
    } else {
      els.resultEmptyState.classList.remove('hidden');
    }
  } else {
    els.compareContainer.classList.add('hidden');
    els.toggleCompareBtn.classList.add('hidden');
    rebuildProcessedOutfit();
    renderManualCanvas();
  }
}

/**
 * Samples corner pixels and removes solid background with soft alpha feathering.
 */
function rebuildProcessedOutfit() {
  if (!state.outfitImgEl) {
    state.processedOutfitCanvas = null;
    return;
  }
  const img = state.outfitImgEl;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  if (state.manual.autoRemoveBg && state.manual.bgTolerance > 0) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;
    const sampleCoords = [
      0,
      (w - 1) * 4,
      ((h - 1) * w) * 4,
      ((h - 1) * w + (w - 1)) * 4,
    ];
    let bgR = 0;
    let bgG = 0;
    let bgB = 0;
    for (const idx of sampleCoords) {
      bgR += data[idx];
      bgG += data[idx + 1];
      bgB += data[idx + 2];
    }
    bgR /= sampleCoords.length;
    bgG /= sampleCoords.length;
    bgB /= sampleCoords.length;

    const tol = state.manual.bgTolerance * 2.2;
    const feather = tol + 28;
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - bgR;
      const dg = data[i + 1] - bgG;
      const db = data[i + 2] - bgB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist < tol) {
        data[i + 3] = 0;
      } else if (dist < feather) {
        const ratio = (dist - tol) / (feather - tol);
        data[i + 3] = Math.round(data[i + 3] * ratio);
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  state.processedOutfitCanvas = canvas;
}

function renderManualCanvas() {
  if (!state.personImgEl) {
    els.manualCanvas.classList.add('hidden');
    els.resultEmptyState.classList.remove('hidden');
    els.resultModeBadge.textContent = '本機手動模式';
    return;
  }

  els.resultEmptyState.classList.add('hidden');
  els.manualCanvas.classList.remove('hidden');
  els.resultModeBadge.textContent = '本機手動預覽（可拖曳衣服）';
  els.resultModeBadge.classList.remove('success');

  const canvas = els.manualCanvas;
  const p = state.personImgEl;
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(p, 0, 0, canvas.width, canvas.height);

  if (state.processedOutfitCanvas) {
    const o = state.processedOutfitCanvas;
    const targetW = canvas.width * state.manual.scale;
    const targetH = targetW * (o.height / o.width);
    const cx = canvas.width * state.manual.xRatio;
    const cy = canvas.height * state.manual.yRatio;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((state.manual.rotation * Math.PI) / 180);
    if (state.manual.flipX) ctx.scale(-1, 1);
    ctx.globalAlpha = state.manual.opacity;
    ctx.filter = `brightness(${state.manual.brightness}%) contrast(${state.manual.contrast}%)`;
    ctx.drawImage(o, -targetW / 2, -targetH / 2, targetW, targetH);
    ctx.restore();
  }
}

function displayResultImage(resultUrl, badgeLabel, aiText = '') {
  state.resultDataUrl = resultUrl;
  els.resultEmptyState.classList.add('hidden');
  els.manualCanvas.classList.add('hidden');
  els.compareContainer.classList.remove('hidden');
  els.compareBeforeImg.src = state.personDataUrl || resultUrl;
  els.compareAfterImg.src = resultUrl;

  const canCompare = Boolean(state.personDataUrl);
  state.compareSingleView = !canCompare;
  els.compareContainer.classList.toggle('single-view', !canCompare);
  els.toggleCompareBtn.classList.toggle('hidden', !canCompare);
  updateCompareSplit(50);

  els.resultModeBadge.textContent = badgeLabel;
  els.resultModeBadge.classList.add('success');
  els.reuseResultBtn.disabled = false;
  els.downloadResultBtn.href = resultUrl;
  els.downloadResultBtn.classList.remove('disabled');

  if (aiText) {
    els.aiNoteBox.textContent = aiText;
    els.aiNoteBox.classList.remove('hidden');
  } else {
    els.aiNoteBox.classList.add('hidden');
  }
}

function updateCompareSplit(percent) {
  const clamped = Math.max(2, Math.min(98, percent));
  state.compareSplit = clamped;
  els.compareAfterLayer.style.clipPath = `inset(0 0 0 ${clamped}%)`;
  els.compareDivider.style.left = `${clamped}%`;
}

function readLocalHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalHistoryItem(imageDataUrl) {
  const items = readLocalHistory();
  const next = [
    { name: `local-${Date.now()}.png`, url: imageDataUrl },
    ...items,
  ].slice(0, 6);
  while (next.length > 0) {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(next));
      return;
    } catch {
      next.pop();
    }
  }
}

async function runAiTryOn() {
  showError('');
  if (!state.personDataUrl || !state.outfitDataUrl) {
    showError('請先上傳「自己的照片」與「穿搭參考圖」（或點擊右上角「載入示範圖片」）。');
    return;
  }

  const apiKey = els.apiKeyInput.value.trim();
  if (!apiKey && !state.hasServerApiKey) {
    els.apiSettingsPanel.classList.remove('hidden');
    showError('尚未輸入 Gemini API Key。請先填入 API Key，或切換至「本機手動疊圖」免費試用！');
    return;
  }

  els.loadingOverlay.classList.remove('hidden');
  els.runAiBtn.disabled = true;

  const options = {
    targetArea: els.targetAreaSelect.value,
    fitStyle: els.fitStyleSelect.value,
    preserveBackground: els.preserveBgCheckbox.checked,
    extraNotes: els.extraNotesInput.value,
  };

  try {
    if (state.backendAvailable) {
      const res = await fetch('./api/tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          model: els.modelSelect.value,
          personImage: state.personDataUrl,
          outfitImage: state.outfitDataUrl,
          options,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI 合成失敗。');
      }

      displayResultImage(data.imageDataUrl, `AI 試穿完成 (${data.model})`, data.text);
    } else {
      const result = await synthesizeWithGemini({
        apiKey,
        model: els.modelSelect.value,
        personImage: state.personDataUrl,
        outfitImage: state.outfitDataUrl,
        options,
      });
      const imageDataUrl = `data:${result.mimeType};base64,${result.base64Data}`;
      saveLocalHistoryItem(imageDataUrl);
      displayResultImage(imageDataUrl, `AI 試穿完成 (${result.model})`, result.text);
    }

    await loadHistory();
  } catch (err) {
    showError(err.message);
  } finally {
    els.loadingOverlay.classList.add('hidden');
    els.runAiBtn.disabled = false;
  }
}

async function loadHistory() {
  try {
    let items = [];
    if (state.backendAvailable) {
      const res = await fetch('./api/outputs');
      const data = await res.json();
      items = data.items || [];
    } else {
      items = readLocalHistory();
    }

    if (!items.length) {
      els.historyGrid.innerHTML = '<p class="hint-text">尚無已儲存的 AI 合成紀錄。</p>';
      return;
    }

    els.historyGrid.innerHTML = '';
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'history-item';
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        setMode('ai');
        displayResultImage(item.url, '歷史合成紀錄');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'history-del';
      delBtn.type = 'button';
      delBtn.title = '刪除';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (state.backendAvailable) {
          await fetch(`./api/outputs/${encodeURIComponent(item.name)}`, { method: 'DELETE' });
        } else {
          const filtered = readLocalHistory().filter((entry) => entry.name !== item.name);
          localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(filtered));
        }
        loadHistory();
      });

      card.append(img, delBtn);
      els.historyGrid.appendChild(card);
    }
  } catch {
    // Ignore transient history fetch errors
  }
}

/**
 * Generates clean synthetic demo images via Canvas so users can try immediately.
 */
async function loadDemoImages() {
  // Demo person photo (clean studio portrait silhouette)
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 600;
  pCanvas.height = 800;
  const pCtx = pCanvas.getContext('2d');
  const grad = pCtx.createLinearGradient(0, 0, 0, 800);
  grad.addColorStop(0, '#dfe7f5');
  grad.addColorStop(1, '#bcc7da');
  pCtx.fillStyle = grad;
  pCtx.fillRect(0, 0, 600, 800);
  // Head & neck
  pCtx.fillStyle = '#f2cbb0';
  pCtx.beginPath();
  pCtx.arc(300, 165, 58, 0, Math.PI * 2);
  pCtx.fill();
  pCtx.fillRect(278, 212, 44, 42);
  // Hair
  pCtx.fillStyle = '#242936';
  pCtx.beginPath();
  pCtx.arc(300, 152, 62, Math.PI, Math.PI * 2);
  pCtx.fill();
  // Plain white tee & jeans
  pCtx.fillStyle = '#f8fafc';
  pCtx.beginPath();
  pCtx.moveTo(215, 250);
  pCtx.lineTo(385, 250);
  pCtx.lineTo(435, 360);
  pCtx.lineTo(390, 385);
  pCtx.lineTo(372, 325);
  pCtx.lineTo(372, 490);
  pCtx.lineTo(228, 490);
  pCtx.lineTo(228, 325);
  pCtx.lineTo(210, 385);
  pCtx.lineTo(165, 360);
  pCtx.closePath();
  pCtx.fill();
  pCtx.fillStyle = '#3b4e74';
  pCtx.fillRect(228, 490, 66, 260);
  pCtx.fillRect(306, 490, 66, 260);

  // Demo outfit image (olive jacket on white background)
  const oCanvas = document.createElement('canvas');
  oCanvas.width = 600;
  oCanvas.height = 600;
  const oCtx = oCanvas.getContext('2d');
  oCtx.fillStyle = '#ffffff';
  oCtx.fillRect(0, 0, 600, 600);
  oCtx.fillStyle = '#3f5d47';
  oCtx.beginPath();
  oCtx.moveTo(190, 110);
  oCtx.lineTo(410, 110);
  oCtx.lineTo(495, 260);
  oCtx.lineTo(435, 290);
  oCtx.lineTo(395, 215);
  oCtx.lineTo(395, 470);
  oCtx.lineTo(205, 470);
  oCtx.lineTo(205, 215);
  oCtx.lineTo(165, 290);
  oCtx.lineTo(105, 260);
  oCtx.closePath();
  oCtx.fill();
  // Collar & zipper
  oCtx.fillStyle = '#273c2d';
  oCtx.fillRect(295, 110, 10, 360);
  oCtx.fillStyle = '#d4a373';
  oCtx.fillRect(228, 280, 44, 54);
  oCtx.fillRect(328, 280, 44, 54);

  await setSlotImage('person', pCanvas.toDataURL('image/png'));
  await setSlotImage('outfit', oCanvas.toDataURL('image/png'));
}

function populateModels(models) {
  els.modelSelect.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    els.modelSelect.appendChild(opt);
  }
  const savedModel = localStorage.getItem(STORAGE_KEY_MODEL);
  if (savedModel && models.some((m) => m.id === savedModel)) {
    els.modelSelect.value = savedModel;
  }
}

async function init() {
  const savedKey = localStorage.getItem(STORAGE_KEY_API) || '';
  if (savedKey) els.apiKeyInput.value = savedKey;

  let models = SUPPORTED_MODELS;
  try {
    const res = await fetch('./api/health');
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      const health = await res.json();
      if (health?.ok) {
        state.backendAvailable = true;
        state.hasServerApiKey = Boolean(health.hasServerApiKey);
        if (Array.isArray(health.models) && health.models.length) {
          models = health.models;
        }
        if (state.hasServerApiKey) {
          els.serverKeyHint.textContent = '偵測到伺服器端已設定 GEMINI_API_KEY，可直接開始 AI 試穿！';
        }
      }
    }
  } catch {
    state.backendAvailable = false;
  }

  if (!state.backendAvailable) {
    els.serverKeyHint.textContent =
      '純前端靜態模式（適用於 GitHub Pages）：金鑰僅由您的瀏覽器直接呼叫 Gemini API，不會經過任何中繼伺服器。';
  }

  populateModels(models);
  updateApiStatusDot();
  loadHistory();
}

// Event wiring
els.toggleApiPanelBtn.addEventListener('click', () => {
  els.apiSettingsPanel.classList.toggle('hidden');
});

els.toggleKeyVisibilityBtn.addEventListener('click', () => {
  const isPwd = els.apiKeyInput.type === 'password';
  els.apiKeyInput.type = isPwd ? 'text' : 'password';
  els.toggleKeyVisibilityBtn.textContent = isPwd ? '隱藏' : '顯示';
});

els.apiKeyInput.addEventListener('input', () => {
  if (els.rememberKeyCheckbox.checked) {
    localStorage.setItem(STORAGE_KEY_API, els.apiKeyInput.value.trim());
  }
  updateApiStatusDot();
});

els.rememberKeyCheckbox.addEventListener('change', () => {
  if (els.rememberKeyCheckbox.checked) {
    localStorage.setItem(STORAGE_KEY_API, els.apiKeyInput.value.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_API);
  }
});

els.modelSelect.addEventListener('change', () => {
  localStorage.setItem(STORAGE_KEY_MODEL, els.modelSelect.value);
});

els.loadDemoBtn.addEventListener('click', loadDemoImages);

bindUploadSlot('person', els.personInput, els.personDropzone, els.clearPersonBtn, els.pastePersonBtn);
bindUploadSlot('outfit', els.outfitInput, els.outfitDropzone, els.clearOutfitBtn, els.pasteOutfitBtn);

els.tabAiBtn.addEventListener('click', () => setMode('ai'));
els.tabManualBtn.addEventListener('click', () => setMode('manual'));
els.runAiBtn.addEventListener('click', runAiTryOn);
els.refreshHistoryBtn.addEventListener('click', loadHistory);

// Manual canvas controls
function bindRange(inputEl, prop, labelEl, suffix, transform = (v) => v, needsRebuild = false) {
  inputEl.addEventListener('input', () => {
    const raw = Number(inputEl.value);
    state.manual[prop] = transform(raw);
    labelEl.textContent = `${raw}${suffix}`;
    if (needsRebuild) rebuildProcessedOutfit();
    renderManualCanvas();
  });
}

bindRange(els.manualScale, 'scale', els.scaleVal, '%', (v) => v / 100);
bindRange(els.manualRotate, 'rotation', els.rotateVal, '°');
bindRange(els.manualBgTol, 'bgTolerance', els.bgTolVal, '', (v) => v, true);
bindRange(els.manualOpacity, 'opacity', els.opacityVal, '%', (v) => v / 100);
bindRange(els.manualBrightness, 'brightness', els.brightVal, '%');
bindRange(els.manualContrast, 'contrast', els.contrastVal, '%');

els.autoRemoveBgCheckbox.addEventListener('change', () => {
  state.manual.autoRemoveBg = els.autoRemoveBgCheckbox.checked;
  rebuildProcessedOutfit();
  renderManualCanvas();
});

els.flipOutfitBtn.addEventListener('click', () => {
  state.manual.flipX = !state.manual.flipX;
  renderManualCanvas();
});

els.resetManualBtn.addEventListener('click', () => {
  state.manual.xRatio = 0.5;
  state.manual.yRatio = 0.52;
  state.manual.scale = 0.55;
  state.manual.rotation = 0;
  state.manual.flipX = false;
  els.manualScale.value = 55;
  els.manualRotate.value = 0;
  els.scaleVal.textContent = '55%';
  els.rotateVal.textContent = '0°';
  renderManualCanvas();
});

els.exportManualBtn.addEventListener('click', () => {
  if (!state.personImgEl || !state.outfitImgEl) {
    showError('請先上傳「自己的照片」與「穿搭參考圖」。');
    return;
  }
  renderManualCanvas();
  const dataUrl = els.manualCanvas.toDataURL('image/png');
  displayResultImage(dataUrl, '本機手動合成');
});

// Drag outfit directly on manual canvas
els.manualCanvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'manual' || !state.processedOutfitCanvas) return;
  state.manual.dragging = true;
  state.manual.dragStartX = e.clientX;
  state.manual.dragStartY = e.clientY;
  state.manual.startXRatio = state.manual.xRatio;
  state.manual.startYRatio = state.manual.yRatio;
  els.manualCanvas.setPointerCapture(e.pointerId);
});

els.manualCanvas.addEventListener('pointermove', (e) => {
  if (!state.manual.dragging) return;
  const rect = els.manualCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dx = (e.clientX - state.manual.dragStartX) / rect.width;
  const dy = (e.clientY - state.manual.dragStartY) / rect.height;
  state.manual.xRatio = Math.max(0.05, Math.min(0.95, state.manual.startXRatio + dx));
  state.manual.yRatio = Math.max(0.05, Math.min(0.95, state.manual.startYRatio + dy));
  renderManualCanvas();
});

els.manualCanvas.addEventListener('pointerup', () => {
  state.manual.dragging = false;
});

// Before/after split slider drag
let comparingDrag = false;
function handleComparePointer(e) {
  const rect = els.compareContainer.getBoundingClientRect();
  if (!rect.width) return;
  const pct = ((e.clientX - rect.left) / rect.width) * 100;
  updateCompareSplit(pct);
}

els.compareDivider.addEventListener('pointerdown', (e) => {
  comparingDrag = true;
  els.compareDivider.setPointerCapture(e.pointerId);
});
window.addEventListener('pointermove', (e) => {
  if (comparingDrag) handleComparePointer(e);
});
window.addEventListener('pointerup', () => {
  comparingDrag = false;
});

els.toggleCompareBtn.addEventListener('click', () => {
  state.compareSingleView = !state.compareSingleView;
  els.compareContainer.classList.toggle('single-view', state.compareSingleView);
});

els.reuseResultBtn.addEventListener('click', async () => {
  if (!state.resultDataUrl) return;
  await setSlotImage('person', state.resultDataUrl);
  showError('');
});

init();
