// src/utils/captcha.js
import logger from "./logger.js";
import { captureScreenshot } from "./screenshot.js";

/*
  Strategy:
  1) quick URL check (facebook uses checkpoint/login-checkpoint paths)
  2) robust selector list (iframes, forms, overlays, dialog roles, attributes)
  3) page-text check (search for phrases Facebook often shows)
  Returns: { detected: boolean, method?: 'url'|'selector'|'text', match?: string, screenshot?: base64|null, snippet?: string|null }
*/

const SELECTORS = [
  "iframe[src*='captcha']",
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  "div[id*='captcha']",
  "div[class*='captcha']",
  "div[aria-label*='Security Check']",
  "div[aria-label*='Confirm Your Identity']",
  "form[action*='checkpoint']",
  "a[href*='/checkpoint']",
  "div[role='dialog']",
  "div[role='alert']",
  "div[data-testid*='captcha']",
];

const TEXT_PATTERNS = [
  "complete a challenge",
  "verify you’re a human",
  "verify you are a human",
  "solve a puzzle",
  "try audio challenge",
  "security check",
  "confirm your identity",
  "prove you are human",
  "type the characters you see",
  "enter the characters",
  "we just need to make sure there’s a real human",
  "to continue, verify",
];

function normalize(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ");
}

export async function detectCaptcha(page) {
  try {
    // 0) quick guard: ensure page has some URL (navigation might be in progress)
    let url = "";
    try {
      url = page.url();
    } catch (e) {
      url = "";
    }

    if (url && /checkpoint|security|login_check|login\/checkpoint/i.test(url)) {
      const shot = await captureScreenshot(page, "captcha-detected");
      logger.warn("Captcha detected by URL", { url });
      return {
        detected: true,
        method: "url",
        match: url,
        screenshot: shot.success ? shot.base64 : null,
        snippet: null,
      };
    }

    // 1) check selectors (do not assume they all exist; catch errors)
    for (const sel of SELECTORS) {
      try {
        const el = await page.$(sel);
        if (el) {
          // small stabilization delay (allow UI to paint)
          await new Promise((r) => setTimeout(r, 300));
          const shot = await captureScreenshot(page, "captcha-detected");
          logger.warn("Captcha detected by selector", { selector: sel });
          return {
            detected: true,
            method: "selector",
            match: sel,
            screenshot: shot.success ? shot.base64 : null,
            snippet: null,
          };
        }
      } catch (e) {
        // ignore selector errors and continue
        logger.debug("selector check error", { selector: sel, err: e.message });
      }
    }

    // 2) text-based detection: read body innerText once and scan for patterns
    let bodyText = "";
    try {
      bodyText = await page.evaluate(
        () => (document.body && document.body.innerText) || ""
      );
    } catch (e) {
      // if execution context destroyed, bail gracefully
      logger.debug("Failed to read page text for captcha detection", {
        err: e.message,
      });
      bodyText = "";
    }

    const normalizedBody = normalize(bodyText);
    for (const pattern of TEXT_PATTERNS) {
      const p = normalize(pattern);
      if (p && normalizedBody.includes(p)) {
        const snippet = normalizedBody.slice(0, 1500);
        const shot = await captureScreenshot(page, "captcha-detected");
        logger.warn("Captcha detected by page text", { pattern: p });
        return {
          detected: true,
          method: "text",
          match: p,
          screenshot: shot.success ? shot.base64 : null,
          snippet,
        };
      }
    }

    // nothing found
    return { detected: false };
  } catch (err) {
    logger.error("detectCaptcha unexpected error", { error: err.message });
    return { detected: false };
  }
}
