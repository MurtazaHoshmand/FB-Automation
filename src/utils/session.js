// src/utils/session.js
import fs from "fs/promises";
import path from "path";

const SESSIONS_DIR = path.join(process.cwd(), "sessions");

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {}
}

export async function saveSession(page, name = "default") {
  await ensureDir(SESSIONS_DIR);
  const cookies = await page.cookies();
  const localStorageData = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      o[k] = localStorage.getItem(k);
    }
    return o;
  });

  const out = {
    cookies,
    localStorage: localStorageData,
    savedAt: new Date().toISOString(),
  };
  const file = path.join(SESSIONS_DIR, `${name}.json`);
  await fs.writeFile(file, JSON.stringify(out, null, 2), "utf8");
  return file;
}

export async function loadSession(page, name = "default") {
  const file = path.join(SESSIONS_DIR, `${name}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.cookies && parsed.cookies.length) {
      await page.setCookie(...parsed.cookies);
    }
    // restore localStorage
    await page.evaluate((data) => {
      try {
        for (const k of Object.keys(data || {})) {
          localStorage.setItem(k, data[k]);
        }
      } catch (e) {}
    }, parsed.localStorage || {});
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function listSessions() {
  try {
    const items = await fs.readdir(SESSIONS_DIR);
    return items.filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}
