// src/controllers/facebookController.js
import logger from "../utils/logger.js";
import { captureScreenshot } from "../utils/screenshot.js";
import { detectCaptcha } from "../utils/captcha.js";
import { wait } from "../utils/wait.js";
import { humanType, smallHumanMove } from "../utils/human.js";
import { saveSession, loadSession } from "../utils/session.js";
// import { markBlocked, isBlocked } from "../utils/circuit.js";
import puppeteer from "puppeteer";

export default class FacebookController {
  constructor(page, opts = {}) {
    if (!page || typeof page.goto !== "function")
      throw new Error("Invalid Puppeteer page passed");
    this.page = page;
    this.opts = opts;
    this.sessionName = opts.sessionName || "default";
    this.minMessageIntervalMs = opts.minMessageIntervalMs || 1000 * 10;
    this._lastActionAt = 0;
  }

  // ensure we don't act too fast
  async throttle() {
    const now = Date.now();
    const waitFor = Math.max(
      0,
      this.minMessageIntervalMs - (now - this._lastActionAt)
    );
    if (waitFor > 0) await wait(waitFor);
    this._lastActionAt = Date.now();
  }

  async initSession() {
    // call once at startup to load cookies/localStorage if available
    try {
      await this.page.setViewport({ width: 1280, height: 800 });
      const loaded = await loadSession(this.page, this.sessionName);
      logger.info("Session loaded", loaded);
      return loaded;
    } catch (e) {
      logger.warn("Session init failed", e.message);
      return null;
    }
  }

  async persistSession() {
    try {
      const path = await saveSession(this.page, this.sessionName);
      logger.info("Session saved", path);
      return path;
    } catch (e) {
      logger.warn("Session save failed", e.message);
      return null;
    }
  }

  async login(email, password) {
    try {
      logger.info("Attempting login...");

      await this.page.goto("https://www.facebook.com/login", {
        waitUntil: "networkidle2",
      });

      // Check if already logged in (home page has the top bar/search box instead of #email)
      const loggedIn = await this.page.$("input[type='search']"); // or another reliable selector
      if (loggedIn) {
        console.log("✅ Already logged in, skipping login.");
        return { success: true, alreadyLoggedIn: true };
      }

      // ensure fields exist
      await this.page.waitForSelector("#email", { timeout: 10000 });
      await this.page.waitForSelector("#pass", { timeout: 10000 });

      await humanType(this.page, "#email", email);
      await humanType(this.page, "#pass", password);
      await smallHumanMove(this.page);

      await Promise.all([
        this.page.click("[name=login]"),
        this.page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })
          .catch(() => {}),
      ]);

      const captcha = await detectCaptcha(this.page);
      if (captcha.detected) {
        const shot = await captureScreenshot(this.page, "login-captcha");
        // markBlocked(email, 1000 * 60 * 30); // block this account for 30m
        return {
          success: false,
          error: "Captcha detected",
          screenshot: shot.success ? shot.urlPath : null,
          detail: captcha,
        };
      }

      // on success save session for future runs
      await this.persistSession();

      logger.info("Login successful");
      return { success: true };
    } catch (err) {
      logger.error("Login failed", { error: err.message });
      return { success: false, error: err.message };
    }
  }

  // async login(page, email, password) {
  //   try {
  //     await page.goto("https://www.facebook.com", {
  //       waitUntil: "domcontentloaded",
  //     });

  //     // Check if already logged in (home page has the top bar/search box instead of #email)
  //     const loggedIn = await page.$("input[placeholder='Search Facebook']"); // or another reliable selector
  //     if (loggedIn) {
  //       console.log("✅ Already logged in, skipping login.");
  //       return { success: true, alreadyLoggedIn: true };
  //     }

  //     // Otherwise, do the login flow
  //     await page.waitForSelector("#email", { timeout: 10000 });
  //     await page.type("#email", email, { delay: 50 });
  //     await page.type("#pass", password, { delay: 50 });
  //     await page.click("button[name='login']");

  //     await page.waitForNavigation({ waitUntil: "networkidle2" });

  //     console.log("✅ Login successful");
  //     return { success: true, loggedIn: true };
  //   } catch (err) {
  //     console.error("❌ Login failed", err.message);
  //     return { success: false, error: err.message };
  //   }
  // }

  // async sendMessage(recipient, text, accountKey = this.sessionName) {
  //   try {
  //     logger.info("sendMessage start", { recipient });

  //     // if (isBlocked(accountKey)) {
  //     //   return { success: false, error: "account_blocked" };
  //     // }

  //     // throttle to avoid rate signals
  //     await this.throttle();

  //     await this.page.goto("https://www.facebook.com/messages/t/", {
  //       waitUntil: "networkidle2",
  //     });

  //     // detect captcha before doing anything
  //     // let captcha = await detectCaptcha(this.page);
  //     // if (captcha.detected) {
  //     //   const shot = await captureScreenshot(this.page, "captcha-before-send");
  //     //   // markBlocked(accountKey, 1000 * 60 * 30);
  //     //   return {
  //     //     success: false,
  //     //     error: "Captcha detected",
  //     //     screenshot: shot.success ? shot.urlPath : null,
  //     //     detail: captcha,
  //     //   };
  //     // }

  //     // Wait main area
  //     await this.page.waitForSelector("div[role='main'], div[role='dialog']", {
  //       timeout: 15000,
  //     });

  //     // find search input robustly
  //     const searchSelectors = [
  //       "input[placeholder*='Search']",
  //       "input[aria-label*='Search']",
  //       "input[type='search']",
  //       "input[role='combobox']",
  //     ];

  //     let searchHandle = null;
  //     for (const sel of searchSelectors) {
  //       try {
  //         const h = await this.page.$(sel);
  //         if (h) {
  //           searchHandle = h;
  //           break;
  //         }
  //       } catch {}
  //     }
  //     if (!searchHandle) {
  //       const shot = await captureScreenshot(this.page, "no-search-input");
  //       return {
  //         success: false,
  //         error: "no_search_input",
  //         screenshot: shot.success ? shot.urlPath : null,
  //       };
  //     }

  //     // human-like type + search
  //     await searchHandle.click({ clickCount: 3 });
  //     await this.page.keyboard.press("Backspace");
  //     await humanType(this.page, searchHandle, recipient);
  //     await this.page.keyboard.press("Enter");
  //     await wait(1200 + Math.random() * 1800);

  //     // After search, there are a few UI forms — results could be:
  //     // - a list of role='option' / role='listitem' nodes on the left
  //     // - a >div> with a Message button inside the result row
  //     // We'll attempt multiple strategies until we can open a chat.

  //     // Strategy A: try to click a row that contains the recipient text
  //     const xpathRow = `//div[@role='button' or @role='option' or @role='listitem' or @role='row']//span[contains(normalize-space(.), "${recipient}")]`;
  //     let nodes = await this.page(xpathRow);

  //     // Strategy B fallback: find any span text matches (looser)
  //     if (!nodes || nodes.length === 0) {
  //       const xpathLoose = `//span[contains(normalize-space(.), "${
  //         recipient.split(" ")[0]
  //       }")]`;
  //       nodes = await this.page(xpathLoose);
  //     }

  //     // If we have nodes, try to click the nearest ancestor that is clickable
  //     if (nodes && nodes.length > 0) {
  //       let opened = false;
  //       for (let n of nodes) {
  //         try {
  //           // find ancestor with role button/listitem/option or clickable anchor
  //           const ancestor = await this.page.evaluateHandle((el) => {
  //             function findAncestor(el) {
  //               let cur = el;
  //               while (cur) {
  //                 if (
  //                   cur.getAttribute &&
  //                   (cur.getAttribute("role") === "option" ||
  //                     cur.getAttribute("role") === "listitem" ||
  //                     cur.getAttribute("role") === "row" ||
  //                     cur.getAttribute("role") === "button")
  //                 )
  //                   return cur;
  //                 cur = cur.parentElement;
  //               }
  //               return null;
  //             }
  //             return findAncestor(el);
  //           }, n);

  //           if (ancestor) {
  //             try {
  //               await ancestor.click();
  //               opened = true;
  //               break;
  //             } catch (e) {
  //               // if ancestor isn't clickable, try clicking the text node itself
  //               try {
  //                 await n.click();
  //                 opened = true;
  //                 break;
  //               } catch (e2) {}
  //             }
  //           } else {
  //             try {
  //               await n.click();
  //               opened = true;
  //               break;
  //             } catch (e) {}
  //           }
  //         } catch (e) {}
  //       }
  //       if (!opened) {
  //         // fallback: try to click first result button if exists
  //         const fallbackBtn = await this.page.$(
  //           "div[role='option'] button, div[role='listitem'] button, div[role='row'] button"
  //         );
  //         if (fallbackBtn) {
  //           await fallbackBtn.click();
  //         } else {
  //           const shot = await captureScreenshot(this.page, "no-clickable-row");
  //           return {
  //             success: false,
  //             error: "no_clickable_row",
  //             screenshot: shot.success ? shot.urlPath : null,
  //           };
  //         }
  //       }
  //     } else {
  //       // no candidate row found
  //       const shot = await captureScreenshot(this.page, "no-search-results");
  //       return {
  //         success: false,
  //         error: "no_search_results",
  //         screenshot: shot.success ? shot.urlPath : null,
  //       };
  //     }

  //     // small wait for chat open
  //     await wait(800 + Math.random() * 1200);

  //     // Wait for message box
  //     const messageSelectors = [
  //       "div[contenteditable='true'][role='textbox']",
  //       "div[role='textbox'][contenteditable='true']",
  //       "div[aria-label='Message']",
  //       "div[aria-label='Write a message']",
  //     ];

  //     let messageHandle = null;
  //     for (const sel of messageSelectors) {
  //       try {
  //         const h = await this.page.$(sel);
  //         if (h) {
  //           messageHandle = h;
  //           break;
  //         }
  //       } catch {}
  //     }

  //     if (!messageHandle) {
  //       const shot = await captureScreenshot(this.page, "no-message-input");
  //       return {
  //         success: false,
  //         error: "no_message_input",
  //         screenshot: shot.success ? shot.urlPath : null,
  //       };
  //     }

  //     // type message and send
  //     await messageHandle.focus();
  //     await humanType(this.page, messageHandle, text);
  //     await this.page.keyboard.press("Enter");
  //     await wait(600 + Math.random() * 1000);

  //     // final captcha check
  //     captcha = await detectCaptcha(this.page);
  //     if (captcha.detected) {
  //       const shot = await captureScreenshot(this.page, "captcha-after-send");
  //       // markBlocked(accountKey, 1000 * 60 * 60); // block longer
  //       return {
  //         success: false,
  //         error: "captcha_after_send",
  //         screenshot: shot.success ? shot.urlPath : null,
  //         detail: captcha,
  //       };
  //     }

  //     // on success, persist session
  //     await this.persistSession();

  //     logger.info("sendMessage success", { recipient });
  //     return { success: true };
  //   } catch (err) {
  //     logger.error("Message failed", { error: err.message });
  //     return { success: false, error: err.message };
  //   }
  // }

  async sendMessage(recipient, text, accountKey = this.sessionName) {
    try {
      logger.info("sendMessage start", { recipient });

      await wait(3000);
      // if (!this.page || typeof this.page != "function") {
      //   return { success: false, error: "page_not_ready" };
      // }

      // Throttle to avoid Facebook rate limits
      await this.throttle();

      // Go to Messenger
      await this.page.goto("https://www.facebook.com/messages/t/", {
        waitUntil: "networkidle2",
      });

      // Detect captcha upfront
      let captcha = await detectCaptcha(this.page);
      if (captcha.detected) {
        const shot = await captureScreenshot(this.page, "captcha-before-send");
        return {
          success: false,
          error: "captcha_detected",
          screenshot: shot.success ? shot.urlPath : null,
        };
      }

      // Wait main container
      await this.page.waitForSelector("div[role='main'], div[role='dialog']", {
        timeout: 15000,
      });

      // Find search input
      const searchSelectors = [
        "input[placeholder*='Search']",
        "input[aria-label*='Search']",
        "input[type='search']",
        "input[role='combobox']",
      ];

      let searchHandle = null;
      for (const sel of searchSelectors) {
        searchHandle = await this.page.$(sel);
        if (searchHandle) break;
      }
      if (!searchHandle) {
        const shot = await captureScreenshot(this.page, "no-search-input");
        return {
          success: false,
          error: "no_search_input",
          screenshot: shot.success ? shot.urlPath : null,
        };
      }

      // Human-like typing in search
      await searchHandle.click({ clickCount: 3 });
      await this.page.keyboard.press("Backspace");
      await humanType(this.page, searchHandle, recipient);
      await this.page.keyboard.press("Enter");
      await wait(10000);

      // Robust XPath search for recipient row
      // Robust XPath search for recipient row
      let nodes = await this.page.$x(
        `//div[contains(@aria-label, 'Message') or contains(@aria-label, 'پیام')]//div[@role='button']`
      );

      if (!nodes || nodes.length === 0) {
        const xpathLoose = `//span[contains(., "${recipient.split(" ")[0]}")]`;
        nodes = await this.page.$x(xpathLoose);
      }

      if (!nodes || nodes.length === 0) {
        const shot = await captureScreenshot(this.page, "no-search-results");
        return {
          success: false,
          error: "no_search_results",
          screenshot: shot.success ? shot.urlPath : null,
        };
      }

      // Click the first clickable ancestor with role=button
      let clicked = false;
      for (const node of nodes) {
        const ancestor = await this.page.evaluateHandle((el) => {
          let cur = el;
          while (cur) {
            if (cur.getAttribute && cur.getAttribute("role") === "button")
              return cur;
            cur = cur.parentElement;
          }
          return null;
        }, node);

        if (ancestor) {
          try {
            await ancestor.click();
            clicked = true;
            break;
          } catch (e) {}
        }
      }

      if (!clicked) {
        const shot = await captureScreenshot(this.page, "no-clickable-row");
        return {
          success: false,
          error: "no_clickable_row",
          screenshot: shot.success ? shot.urlPath : null,
        };
      }

      // Wait for chat input
      await wait(800 + Math.random() * 1200);
      const messageSelectors = [
        "div[contenteditable='true'][role='textbox']",
        "div[role='textbox'][contenteditable='true']",
        "div[role='button'] div[contenteditable='true']",
      ];

      let messageHandle = null;
      for (const sel of messageSelectors) {
        messageHandle = await this.page.$(sel);
        if (messageHandle) break;
      }
      if (!messageHandle) {
        const shot = await captureScreenshot(this.page, "no-message-input");
        return {
          success: false,
          error: "no_message_input",
          screenshot: shot.success ? shot.urlPath : null,
        };
      }

      // Type message and send
      await messageHandle.focus();
      await humanType(this.page, messageHandle, text);
      await this.page.keyboard.press("Enter");
      await wait(500 + Math.random() * 800);

      // Detect captcha again
      captcha = await detectCaptcha(this.page);
      if (captcha.detected) {
        const shot = await captureScreenshot(this.page, "captcha-after-send");
        return {
          success: false,
          error: "captcha_after_send",
          screenshot: shot.success ? shot.urlPath : null,
          detail: captcha,
        };
      }

      // Save session after success
      await this.persistSession();

      logger.info("sendMessage success", { recipient });
      return { success: true };
    } catch (err) {
      logger.error("Message failed", { error: err.message });
      return { success: false, error: err.message };
    }
  }

  // Usage example:
}
