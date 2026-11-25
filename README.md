# AI 虛擬試穿工作室 (Virtual Try-On Studio)

上傳一張**自己的照片**與一張**穿搭參考圖**，即可將穿搭自然合成到你的照片上。

**線上網頁版（Live Demo）**：https://asdw4848.github.io/outfit-tryon/

本專案**同時支援兩種部署／運行方式**，零外部 npm 相依：
- **GitHub Pages 純前端靜態部署**：上傳到 GitHub 後啟用 Pages，免後端伺服器即可直接在瀏覽器使用（支援離線手動去背疊圖，及由瀏覽器直連 Gemini API 進行 AI 換裝）。
- **本機 Node.js 伺服器**：可透過 `.env` 設定 `GEMINI_API_KEY`，並將 AI 合成結果自動儲存至本機 `outputs/` 資料夾。

---

## 功能特色

- **雙模式試穿**：
  - **AI 智慧換裝**：使用 Google Gemini 原生生圖模型（`gemini-2.5-flash-image` / `gemini-3-pro-image-preview`），支援全身穿搭、僅換上衣、僅換下身、外搭外套、連身洋裝與版型調整。
  - **本機手動疊圖（免 API Key）**：內建單色背景智慧去背、拖曳對齊、縮放、旋轉、翻轉、透明度與亮度／對比微調。
- **前後對比滑桿**：可左右拖曳即時比對原圖與合成後效果。
- **連續疊穿**：一鍵將合成結果設為新的個人照，繼續外搭外套或更換下身。
- **多方式上傳**：支援拖曳圖片、選檔上傳、剪貼簿貼上與一鍵載入示範圖片。

---

## 方案 A：直接丟到 GitHub 並用 GitHub Pages 免費上線

本專案已內建 `.github/workflows/pages.yml` 與 `.github/workflows/ci.yml`：

1. 在 GitHub 建立一個新的 Repository（例如 `virtual-tryon-studio`）。
2. 將整個 `virtual-tryon` 資料夾內的所有檔案上傳至該 Repository 的 `main` 分支（可用網頁 **Upload files**、**GitHub Desktop**，或使用 Git 指令）：
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Virtual Try-On Studio"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/<你的Repo>.git
   git push -u origin main
   ```
3. 到 GitHub Repository 的 **Settings → Pages → Build and deployment → Source**，選擇 **GitHub Actions**。
4. 等待 `Deploy to GitHub Pages` workflow 執行完成，即可透過 `https://<你的帳號>.github.io/<你的Repo>/`（本專案為 [https://asdw4848.github.io/outfit-tryon/](https://asdw4848.github.io/outfit-tryon/)）直接開啟使用！

> **安全性說明**：在 GitHub Pages 靜態模式下，使用者輸入的 Gemini API Key 僅保存於自己瀏覽器的 `localStorage` 中，並直接發送給 Google Gemini API，不會寫入任何後端或倉庫。

---

## 方案 B：在本機執行（Node.js >= 20）

```bash
node server.mjs
```

或在 Windows 直接雙擊 `start.bat`，瀏覽器開啟 `http://localhost:3000`。

### 設定伺服器端 `.env`（選用）

```bash
cp .env.example .env
# 編輯 .env 填入 GEMINI_API_KEY=你的金鑰
```

---

## 測試與檢查

```bash
node --test tests/server.test.mjs
```

## 專案結構

```text
├── .github/workflows/
│   ├── ci.yml              # GitHub Actions 自動語法檢查與測試
│   └── pages.yml           # 自動部署 public/ 至 GitHub Pages
├── lib/
│   └── tryon.mjs           # Node.js 端環境載入與共用模組匯出
├── public/
│   ├── index.html          # 主畫面
│   ├── styles.css          # 介面樣式
│   ├── app.js              # 前端互動、Canvas 合成與雙環境適配
│   └── tryon-core.js       # 瀏覽器／Node 共用的 Gemini Try-On 核心邏輯
├── tests/
│   └── server.test.mjs     # 單元與 HTTP API 整合測試
├── server.mjs              # 零相依 Node.js HTTP 伺服器
├── start.bat               # Windows 一鍵啟動腳本
├── .env.example            # 環境變數範本
├── .gitignore
├── LICENSE                 # MIT License
└── package.json
```

## License

[MIT](./LICENSE)
