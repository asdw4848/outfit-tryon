import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SUPPORTED_MODELS,
  loadEnvFile,
  synthesizeWithGemini,
} from './lib/tryon.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('上傳資料過大，請壓縮圖片後再試（上限 25MB）。'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('無效的 JSON 請求內容。'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function extensionForMime(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function serveStaticFile(res, baseDir, relPath) {
  const safeBase = path.resolve(baseDir);
  const target = path.resolve(safeBase, `.${relPath}`);
  if (!target.startsWith(safeBase + path.sep) && target !== safeBase) {
    sendJson(res, 403, { error: 'Forbidden' });
    return true;
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return false;
  }
  const ext = path.extname(target).toLowerCase();
  const contentType = STATIC_MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(target).pipe(res);
  return true;
}

/**
 * Creates the HTTP server for Virtual Try-On Studio.
 */
export function createAppServer({
  publicDir = path.join(__dirname, 'public'),
  outputsDir = path.join(__dirname, 'outputs'),
  synthesizeFn = synthesizeWithGemini,
} = {}) {
  fs.mkdirSync(outputsDir, { recursive: true });

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);

      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, {
          ok: true,
          hasServerApiKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
          models: SUPPORTED_MODELS,
        });
      }

      if (req.method === 'GET' && pathname === '/api/outputs') {
        const files = fs
          .readdirSync(outputsDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
          .map((entry) => {
            const fullPath = path.join(outputsDir, entry.name);
            const stat = fs.statSync(fullPath);
            return {
              name: entry.name,
              url: `/outputs/${encodeURIComponent(entry.name)}`,
              createdAt: stat.mtime.toISOString(),
              size: stat.size,
            };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 24);
        return sendJson(res, 200, { items: files });
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/outputs/')) {
        const name = pathname.slice('/api/outputs/'.length);
        if (!SAFE_FILENAME_RE.test(name)) {
          return sendJson(res, 400, { error: '無效的檔案名稱。' });
        }
        const target = path.join(outputsDir, name);
        if (!fs.existsSync(target)) {
          return sendJson(res, 404, { error: '找不到該紀錄圖片。' });
        }
        fs.unlinkSync(target);
        return sendJson(res, 200, { deleted: name });
      }

      if (req.method === 'POST' && pathname === '/api/tryon') {
        const body = await readJsonBody(req);
        const apiKey = (body.apiKey || process.env.GEMINI_API_KEY || '').trim();
        if (!apiKey) {
          return sendJson(res, 400, {
            error:
              '尚未設定 Gemini API Key。請在右上角「AI 設定」輸入金鑰，或切換至「本機手動合成模式」免費離線試穿！',
          });
        }

        const result = await synthesizeFn({
          apiKey,
          model: body.model || 'gemini-2.5-flash-image',
          personImage: body.personImage,
          outfitImage: body.outfitImage,
          options: body.options || {},
        });

        const ext = extensionForMime(result.mimeType);
        const fileName = `tryon-${Date.now()}.${ext}`;
        const outPath = path.join(outputsDir, fileName);
        fs.writeFileSync(outPath, Buffer.from(result.base64Data, 'base64'));

        return sendJson(res, 200, {
          imageDataUrl: `data:${result.mimeType};base64,${result.base64Data}`,
          text: result.text || '',
          model: result.model,
          savedFile: {
            name: fileName,
            url: `/outputs/${encodeURIComponent(fileName)}`,
          },
        });
      }

      if (req.method === 'GET' && pathname.startsWith('/outputs/')) {
        const rel = pathname.slice('/outputs'.length);
        if (serveStaticFile(res, outputsDir, rel)) return;
        return sendJson(res, 404, { error: 'Not found' });
      }

      if (req.method === 'GET') {
        const targetPath = pathname === '/' ? '/index.html' : pathname;
        if (serveStaticFile(res, publicDir, targetPath)) return;
        return sendJson(res, 404, { error: 'Not found' });
      }

      sendJson(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      const status = error.statusCode || 500;
      sendJson(res, status, { error: error.message || '伺服器發生未知錯誤。' });
    }
  });
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  loadEnvFile(path.join(__dirname, '.env'));
  const port = Number(process.env.PORT) || 3000;
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`Virtual Try-On Studio running at http://localhost:${port}`);
  });
}
