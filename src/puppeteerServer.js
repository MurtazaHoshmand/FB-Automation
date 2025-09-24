// src/puppeteerServer.js
import express from "express";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs/promises";
import puppeteer from "puppeteer";
import FacebookController from "./controllers/facebookController.js";
import { captureScreenshot } from "./utils/screenshot.js";
import { loadSession, saveSession } from "./utils/session.js";

const app = express();
app.use(bodyParser.json({ limit: "5mb" }));

// serve screenshots
app.use(
  "/screenshots",
  express.static(path.join(process.cwd(), "screenshots"))
);

let browser, page, fb;
let fbReady = false;

(async () => {
  browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1280,800",
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  fb = new FacebookController(page, {
    sessionName: "default",
    minMessageIntervalMs: 10000,
  });

  await fb.initSession();
  fbReady = true; // mark ready
})();

// Login endpoint
app.post("/login", async (req, res) => {
  if (!fb) return res.status(503).json({ success: false, error: "not_ready" });
  const { email, password } = req.body;
  const result = await fb.login(email, password);
  // respond 400 for controlled failure (captcha etc.)
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

// Send message
app.post("/sendMessage", async (req, res) => {
  if (!fbReady || !fb) {
    return res.status(400).json({ success: false, error: "page_not_ready" });
  }
  const { recipient, text } = req.body;
  const result = await fb.sendMessage(recipient, text, "default");
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

// Upload a session JSON (from human ops after manual login) to replace session file
app.post("/uploadSession", async (req, res) => {
  try {
    const { sessionName = "default", session } = req.body;
    if (!session)
      return res.status(400).json({ success: false, error: "no_session" });

    const sessionsDir = path.join(process.cwd(), "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const filePath = path.join(sessionsDir, `${sessionName}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf8");

    // load it immediately
    await loadSession(page, sessionName);
    return res.json({ success: true, file: filePath });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(3000, () => console.log("Puppeteer API running on port 3000"));
