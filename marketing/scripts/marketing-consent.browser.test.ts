import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { getPricingFaqs } from "../shared/structured-data-content";

type CdpReply = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

type CdpPending = {
  resolve: (reply: CdpReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a debug port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitFor<T>(
  description: string,
  getValue: () => Promise<T | null>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await getValue();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}`);
}

function createCdpClient(socket: WebSocket) {
  let nextId = 0;
  const pending = new Map<number, CdpPending>();

  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as CdpReply;
    if (message.id === undefined) return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message || "CDP request failed"));
    else request.resolve(message);
  });

  return {
    send(method: string, params: Record<string, unknown> = {}): Promise<CdpReply> {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Browser did not answer ${method}`));
        }, 8_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate<T>(expression: string): Promise<T> {
      const reply = await this.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const result = reply.result as {
        exceptionDetails?: { text?: string };
        result?: { value?: T };
      };
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
      }
      return result.result?.value as T;
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("CDP client closed"));
      }
      pending.clear();
      socket.close();
    },
  };
}

async function verifyBrowserPricingLanguage(
  cdp: ReturnType<typeof createCdpClient>,
  url: string,
  language: string,
): Promise<void> {
  const navigation = await cdp.send("Page.navigate", { url });
  assert.equal(navigation.result?.errorText, undefined, `navigation to ${url} must succeed`);
  const initialState = await waitFor(
    `${language} pricing markup`,
    () => cdp.evaluate<{
      ready: boolean;
      lang: string;
      href: string;
      rootTextLength: number;
    }>(
      `({ ready: document.readyState === "complete", lang: document.documentElement.lang, ` +
        `href: location.href, rootTextLength: document.querySelector('#root')?.textContent?.length || 0 })`,
    ).then((state) => (state.ready && state.rootTextLength > 0 ? state : null)),
  );
  assert.equal(
    initialState.lang,
    language,
    `${language} document language should come from SSR (${initialState.href})`,
  );

  const expectedAnswer =
    getPricingFaqs(language).find(
      (faq) => faq.question === "What happens after the 14-day trial?",
    )?.answer || "";
  const expectedNotice =
    language === "fr"
      ? "Carte bancaire requise · débit automatique après 14 jours sauf annulation"
      : "Card required · billed automatically after 14 days unless cancelled";
  assert.ok(expectedAnswer);

  const result = await cdp.evaluate<{
    answerInDom: boolean;
    answerVisibleAfterOpening: boolean;
    noticeCount: number;
    jsonLdHasAnswer: boolean;
    lang: string;
  }>(
    `new Promise(resolve => { ` +
      `const answer = ${JSON.stringify(expectedAnswer)}; ` +
      `const notice = ${JSON.stringify(expectedNotice)}; ` +
      `const trigger = [...document.querySelectorAll('button')].find(button => ` +
      `button.textContent?.includes('What happens after the 14-day trial?')); ` +
      `trigger?.click(); setTimeout(() => { ` +
      `const faq = [...document.querySelectorAll('script[type="application/ld+json"][data-json-ld="true"]')]` +
      `.map(script => { try { return JSON.parse(script.textContent || 'null'); } catch { return null; } })` +
      `.find(schema => schema?.['@type'] === 'FAQPage'); ` +
      `resolve({ lang: document.documentElement.lang, ` +
      `answerInDom: Boolean(document.querySelector('#root')?.textContent?.includes(answer)), ` +
      `answerVisibleAfterOpening: document.body.innerText.includes(answer), ` +
      `noticeCount: [...document.querySelectorAll('span[translate="no"]')]` +
      `.filter(span => span.textContent === notice).length, ` +
      `jsonLdHasAnswer: Boolean(faq?.mainEntity?.some(item => ` +
      `item.acceptedAnswer?.text === answer)) }); }, 180); })`,
  );

  assert.equal(result.lang, language);
  assert.equal(result.answerInDom, true, `${language} FAQ answer must be in the hydrated DOM`);
  assert.equal(result.answerVisibleAfterOpening, true, `${language} answer must show when opened`);
  assert.ok(result.noticeCount >= 1, `${language} trial disclosure must be rendered by React`);
  assert.equal(result.jsonLdHasAnswer, true, `${language} JSON-LD must match the FAQ answer`);
}

test(
  "real Chromium stays responsive after consent and adds fp_vid to the Pro link",
  { timeout: 45_000 },
  async () => {
    const executable =
      process.env["CHROMIUM_PATH"] ||
      ["/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
        .find((candidate) => existsSync(candidate));
    assert.ok(executable && existsSync(executable), "Chromium must be installed for this regression test");

    const port = await reservePort();
    const profile = mkdtempSync(path.join(tmpdir(), "flowpoint-marketing-chromium-"));
    let browser: ChildProcess | undefined;
    let cdp: ReturnType<typeof createCdpClient> | undefined;
    try {
      browser = spawn(
        executable,
        [
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdio: "ignore" },
      );

      const debugBase = `http://127.0.0.1:${port}`;
      await waitFor("Chromium DevTools", async () => {
        const response = await fetch(`${debugBase}/json/version`);
        return response.ok ? true : null;
      });

      const target = await waitFor("a Chromium page target", async () => {
        const response = await fetch(`${debugBase}/json/list`);
        if (!response.ok) return null;
        const targets = (await response.json()) as Array<{
          type: string;
          webSocketDebuggerUrl: string;
        }>;
        return targets.find((item) => item.type === "page") || null;
      });

      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      cdp = createCdpClient(socket);
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Network.enable");
      await cdp.send("Network.setBlockedURLs", {
        urls: [
          "https://translate.google.com/*",
          "https://translate.googleapis.com/*",
          "https://www.googletagmanager.com/*",
        ],
      });
      await cdp.send("Page.navigate", {
        url: process.env["MARKETING_TEST_URL"] || "http://127.0.0.1:5000/pricing",
      });

      const ready = await waitFor(
        "the pricing page and cookie accept button",
        () =>
          cdp!.evaluate<boolean>(
            `document.readyState === "complete" && ` +
              `Boolean(document.querySelector('[data-testid="button-cookie-accept"]')) && ` +
              `Boolean(document.querySelector('a[href*="plan=pro"]'))`,
          ).then((value) => (value ? true : null)),
      );
      assert.equal(ready, true);

      await cdp.evaluate<boolean>(
        `(() => { const button = document.querySelector('[data-testid="button-cookie-accept"]'); ` +
          `if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`,
      );

      const result = await waitFor(
        "a responsive page with an attributed Pro link",
        () =>
          cdp!.evaluate<{
            ticks: number;
            consent: string | null;
            href: string | null;
            visitorId: string | null;
          }>(
            `new Promise(resolve => { let ticks = 0; const tick = () => { ` +
              `ticks += 1; if (ticks < 4) return setTimeout(tick, 25); ` +
              `const link = [...document.querySelectorAll('a[href]')].find(a => ` +
              `new URL(a.href).searchParams.get('plan') === 'pro'); ` +
              `const href = link?.href ?? null; resolve({ ticks, ` +
              `consent: localStorage.getItem('cookie_consent'), href, ` +
              `visitorId: href ? new URL(href).searchParams.get('fp_vid') : null }); ` +
              `}; setTimeout(tick, 25); })`,
          ).then((value) => (value.ticks >= 4 ? value : null)),
      );

      assert.equal(result.consent, "accepted");
      assert.ok(result.visitorId, "the accepted Pro link must include fp_vid");
      assert.match(
        result.visitorId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      assert.equal(new URL(result.href || "").searchParams.get("plan"), "pro");
      assert.equal(result.ticks, 4, "browser timers must continue to run after consent");

      const baseUrl = process.env["MARKETING_TEST_URL"] || "http://127.0.0.1:5000/pricing";
      const base = new URL(baseUrl);
      await cdp.send("Network.setCookie", {
        name: "googtrans",
        value: "/en/en",
        url: base.origin,
        path: "/",
      });
      await verifyBrowserPricingLanguage(
        cdp,
        `${base.origin}/pricing?lang=fr`,
        "fr",
      );

      await cdp.send("Network.setCookie", {
        name: "googtrans",
        value: "/en/fr",
        url: base.origin,
        path: "/",
      });
      await verifyBrowserPricingLanguage(cdp, `${base.origin}/pricing`, "fr");
    } finally {
      if (cdp) {
        try {
          await cdp.send("Browser.close");
        } catch {
          // Chromium may already have exited after a failed DevTools request.
        }
        cdp.close();
      }
      if (browser && browser.exitCode === null) {
        const exited = new Promise<void>((resolve) => {
          browser!.once("exit", () => resolve());
        });
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
        if (browser.exitCode === null) {
          const killed = new Promise<void>((resolve) => {
            browser!.once("exit", () => resolve());
          });
          browser.kill("SIGTERM");
          await Promise.race([killed, new Promise((resolve) => setTimeout(resolve, 3_000))]);
          if (browser.exitCode === null) {
            const forceKilled = new Promise<void>((resolve) => {
              browser!.once("exit", () => resolve());
            });
            browser.kill("SIGKILL");
            await Promise.race([
              forceKilled,
              new Promise((resolve) => setTimeout(resolve, 3_000)),
            ]);
          }
        }
      }
      rmSync(profile, {
        recursive: true,
        force: true,
        maxRetries: 15,
        retryDelay: 200,
      });
    }
  },
);
