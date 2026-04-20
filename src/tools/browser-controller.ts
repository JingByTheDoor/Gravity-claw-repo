import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from "playwright";
import type { Logger } from "../logging/logger.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TEXT_LENGTH = 4_000;
const DEFAULT_MAX_ELEMENTS = 25;
const POPUP_WAIT_TIMEOUT_MS = 1_500;

export interface BrowserNavigateResult {
  ok: boolean;
  url: string;
  title: string;
  status: number | null;
}

export interface BrowserSnapshotElement {
  tag: string;
  role: string;
  text: string;
  label?: string;
  placeholder?: string;
  name?: string;
  type?: string;
  selector?: string;
  href?: string;
}

export interface BrowserSnapshotResult {
  ok: boolean;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  elements: BrowserSnapshotElement[];
}

export interface BrowserClickResult {
  ok: boolean;
  url: string;
  title: string;
  target: string;
}

export interface BrowserTypeResult {
  ok: boolean;
  url: string;
  title: string;
  target: string;
  textLength: number;
  submitted: boolean;
}

export interface BrowserScreenshotResult {
  ok: boolean;
  url: string;
  title: string;
  path: string;
  fullPage: boolean;
}

export interface BrowserCloseResult {
  ok: boolean;
  closed: boolean;
}

export interface BrowserClickTarget {
  selector?: string;
  text?: string;
  exact?: boolean;
}

export interface BrowserTypeTarget {
  selector?: string;
  label?: string;
  placeholder?: string;
  name?: string;
}

interface BrowserSnapshotOptions {
  maxTextLength?: number;
  maxElements?: number;
}

interface BrowserTypeOptions extends BrowserTypeTarget {
  text: string;
  clearFirst?: boolean;
  pressEnter?: boolean;
}

interface BrowserScreenshotOptions {
  outputPath?: string;
  fullPage?: boolean;
}

interface BrowserControllerOptions {
  logger: Logger;
  artifactsDir?: string;
  platform?: NodeJS.Platform;
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (!value || value <= 0) {
    return fallback;
  }

  return Math.trunc(value);
}

function describeClickTarget(target: BrowserClickTarget): string {
  if (target.selector) {
    return `selector:${target.selector}`;
  }

  return `text:${target.text ?? ""}`;
}

function describeTypeTarget(target: BrowserTypeTarget): string {
  if (target.selector) {
    return `selector:${target.selector}`;
  }
  if (target.label) {
    return `label:${target.label}`;
  }
  if (target.placeholder) {
    return `placeholder:${target.placeholder}`;
  }

  return `name:${target.name ?? ""}`;
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("url must be a non-empty string.");
  }

  const explicitSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//i;
  const localSchemePattern = /^(about|data|file|mailto|tel):/i;
  if (explicitSchemePattern.test(trimmed) || localSchemePattern.test(trimmed)) {
    return trimmed;
  }

  const localHostPattern = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(:\d+)?(?:\/|$)/i;
  const withScheme = `${localHostPattern.test(trimmed) ? "http" : "https"}://${trimmed}`;
  return new URL(withScheme).toString();
}

export class BrowserController {
  private readonly artifactsDir: string;
  private readonly platform: NodeJS.Platform;
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private pageInitialization: Promise<Page> | undefined;

  constructor(private readonly options: BrowserControllerOptions) {
    this.artifactsDir =
      options.artifactsDir ?? path.resolve(process.cwd(), "artifacts", "screenshots");
    this.platform = options.platform ?? process.platform;
  }

  async navigate(url: string, timeoutMs?: number): Promise<BrowserNavigateResult> {
    const page = await this.ensurePage();
    const response = await page.goto(normalizeUrl(url), {
      waitUntil: "domcontentloaded",
      timeout: clampPositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS)
    });

    return {
      ok: true,
      ...(await this.getPageSummary(page)),
      status: response?.status() ?? null
    };
  }

  async snapshot(options: BrowserSnapshotOptions = {}): Promise<BrowserSnapshotResult> {
    const page = await this.ensurePage();
    const maxTextLength = clampPositiveInteger(options.maxTextLength, DEFAULT_MAX_TEXT_LENGTH);
    const maxElements = clampPositiveInteger(options.maxElements, DEFAULT_MAX_ELEMENTS);
    const snapshot = await page.evaluate(
      ({ textLimit, elementLimit }) => {
        const browserGlobal = globalThis as unknown as {
          CSS?: { escape?: (value: string) => string };
          document: {
            title?: string;
            body?: { innerText?: string };
            querySelector: (selector: string) => unknown;
            querySelectorAll: (selector: string) => Iterable<unknown>;
          };
          getComputedStyle: (element: {
            getBoundingClientRect: () => { width: number; height: number };
          }) => { display: string; visibility: string; opacity?: string };
          location?: { href?: string };
        };

        const normalizeInline = (value: unknown): string =>
          String(value ?? "")
            .replace(/\s+/g, " ")
            .trim();
        const normalizeBlock = (value: unknown): string =>
          String(value ?? "")
            .replace(/\r/g, "")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        const escapeCssIdentifier = (value: string): string => {
          if (browserGlobal.CSS && typeof browserGlobal.CSS.escape === "function") {
            return browserGlobal.CSS.escape(value);
          }

          return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        };
        const escapeCssAttribute = (value: string): string =>
          value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const readAssociatedLabel = (element: {
          id?: string;
          closest: (selector: string) => { textContent?: string } | null;
          getAttribute: (name: string) => string | null;
        }): string => {
          const ariaLabel = normalizeInline(element.getAttribute("aria-label"));
          if (ariaLabel) {
            return ariaLabel;
          }

          if (element.id) {
            const explicitLabel = browserGlobal.document.querySelector(
              `label[for="${escapeCssIdentifier(element.id)}"]`
            ) as { textContent?: string } | null;
            const explicitText = normalizeInline(explicitLabel?.textContent);
            if (explicitText) {
              return explicitText;
            }
          }

          return normalizeInline(element.closest("label")?.textContent);
        };
        const isVisible = (element: {
          closest: (selector: string) => unknown;
          getBoundingClientRect: () => { width: number; height: number };
        }): boolean => {
          if (element.closest("[aria-hidden='true']")) {
            return false;
          }

          const style = browserGlobal.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        };

        const interactiveNodes = Array.from(
          browserGlobal.document.querySelectorAll(
            "a,button,input,textarea,select,[role='button'],[role='link'],[contenteditable='true']"
          )
        ) as Array<{
          tagName?: string;
          id?: string;
          value?: string;
          innerText?: string;
          textContent?: string;
          placeholder?: string;
          href?: string;
          type?: string;
          getAttribute: (name: string) => string | null;
          closest: (selector: string) => { textContent?: string } | null;
          getBoundingClientRect: () => { width: number; height: number };
        }>;

        const elements = interactiveNodes
          .flatMap((element) => {
            if (!isVisible(element)) {
              return [];
            }

            const tag = String(element.tagName ?? "").toLowerCase();
            const text = normalizeInline(
              element.innerText ?? element.textContent ?? element.value ?? ""
            );
            const label = readAssociatedLabel(element);
            const placeholder = normalizeInline(element.placeholder);
            const name = normalizeInline(element.getAttribute("name"));
            const type = normalizeInline(element.type ?? element.getAttribute("type"));
            const href = tag === "a" ? normalizeInline(element.getAttribute("href") ?? element.href) : "";
            const selector = element.id
              ? `#${escapeCssIdentifier(element.id)}`
              : name
                ? `${tag}[name="${escapeCssAttribute(name)}"]`
                : href
                  ? `a[href="${escapeCssAttribute(href)}"]`
                  : undefined;
            const summary = {
              tag,
              role: normalizeInline(element.getAttribute("role")) || tag,
              text,
              ...(label ? { label } : {}),
              ...(placeholder ? { placeholder } : {}),
              ...(name ? { name } : {}),
              ...(type ? { type } : {}),
              ...(selector ? { selector } : {}),
              ...(href ? { href } : {})
            };

            return [summary];
          })
          .slice(0, elementLimit);

        const fullText = normalizeBlock(browserGlobal.document.body?.innerText ?? "");
        return {
          url: String(browserGlobal.location?.href ?? ""),
          title: String(browserGlobal.document.title ?? ""),
          text: fullText.slice(0, textLimit),
          truncated: fullText.length > textLimit,
          elements
        };
      },
      {
        textLimit: maxTextLength,
        elementLimit: maxElements
      }
    );

    return {
      ok: true,
      url: snapshot.url,
      title: snapshot.title,
      text: snapshot.text,
      truncated: snapshot.truncated,
      elements: snapshot.elements as BrowserSnapshotElement[]
    };
  }

  async click(target: BrowserClickTarget, timeoutMs?: number): Promise<BrowserClickResult> {
    const page = await this.ensurePage();
    const timeout = clampPositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
    const locator = this.resolveClickLocator(page, target);
    const popupPromise = page.waitForEvent("popup", {
      timeout: Math.min(timeout, POPUP_WAIT_TIMEOUT_MS)
    }).catch(() => null);

    await locator.click({ timeout });
    const popupPage = await popupPromise;
    const activePage = popupPage ?? page;
    if (popupPage) {
      this.page = popupPage;
    }

    await activePage.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);

    return {
      ok: true,
      ...(await this.getPageSummary(activePage)),
      target: describeClickTarget(target)
    };
  }

  async type(options: BrowserTypeOptions, timeoutMs?: number): Promise<BrowserTypeResult> {
    const page = await this.ensurePage();
    const timeout = clampPositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
    const locator = this.resolveTypeLocator(page, options);

    if (options.clearFirst ?? true) {
      await locator.fill(options.text, { timeout });
    } else {
      await locator.focus({ timeout });
      await locator.pressSequentially(options.text, { timeout });
    }

    if (options.pressEnter) {
      await locator.press("Enter", { timeout });
    }

    await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);

    return {
      ok: true,
      ...(await this.getPageSummary(page)),
      target: describeTypeTarget(options),
      textLength: options.text.length,
      submitted: options.pressEnter ?? false
    };
  }

  async screenshot(options: BrowserScreenshotOptions = {}): Promise<BrowserScreenshotResult> {
    const page = await this.ensurePage();
    await fs.mkdir(this.artifactsDir, { recursive: true });
    const outputPath = options.outputPath
      ? path.resolve(options.outputPath)
      : path.join(this.artifactsDir, `browser-${Date.now()}.png`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    await page.screenshot({
      path: outputPath,
      fullPage: options.fullPage ?? true
    });

    return {
      ok: true,
      ...(await this.getPageSummary(page)),
      path: outputPath,
      fullPage: options.fullPage ?? true
    };
  }

  async close(): Promise<BrowserCloseResult> {
    const hadSession = Boolean(
      this.pageInitialization ||
        (this.page && !this.page.isClosed()) ||
        this.context ||
        (this.browser && this.browser.isConnected())
    );

    this.pageInitialization = undefined;

    try {
      if (this.context) {
        await this.context.close();
      }
      if (this.browser?.isConnected()) {
        await this.browser.close();
      }
    } finally {
      this.page = undefined;
      this.context = undefined;
      this.browser = undefined;
    }

    return {
      ok: true,
      closed: hadSession
    };
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    if (this.pageInitialization) {
      return this.pageInitialization;
    }

    this.pageInitialization = this.initializePage();
    try {
      const page = await this.pageInitialization;
      this.page = page;
      return page;
    } finally {
      this.pageInitialization = undefined;
    }
  }

  private async initializePage(): Promise<Page> {
    const browser = await this.ensureBrowser();
    const context = await this.ensureContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
    return page;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    const launchOptions: LaunchOptions = {
      headless: true
    };

    try {
      this.browser = await chromium.launch(launchOptions);
    } catch (error) {
      if (this.platform !== "win32") {
        throw error;
      }

      this.options.logger.warn("browser.launch.chromium_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      this.browser = await chromium.launch({
        headless: true,
        channel: "msedge"
      });
    }

    this.browser.on("disconnected", () => {
      this.browser = undefined;
      this.context = undefined;
      this.page = undefined;
    });

    return this.browser;
  }

  private async ensureContext(browser: Browser): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    this.context = await browser.newContext({
      viewport: {
        width: 1440,
        height: 900
      },
      ignoreHTTPSErrors: true
    });
    return this.context;
  }

  private async getPageSummary(page: Page): Promise<{ url: string; title: string }> {
    return {
      url: page.url(),
      title: await page.title()
    };
  }

  private resolveClickLocator(page: Page, target: BrowserClickTarget) {
    if (target.selector?.trim()) {
      return page.locator(target.selector).first();
    }
    if (target.text?.trim()) {
      return page.getByText(target.text, { exact: target.exact ?? false }).first();
    }

    throw new Error("browser_click requires selector or text.");
  }

  private resolveTypeLocator(page: Page, target: BrowserTypeTarget) {
    if (target.selector?.trim()) {
      return page.locator(target.selector).first();
    }
    if (target.label?.trim()) {
      return page.getByLabel(target.label).first();
    }
    if (target.placeholder?.trim()) {
      return page.getByPlaceholder(target.placeholder).first();
    }
    if (target.name?.trim()) {
      const escapedName = target.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return page.locator(`[name="${escapedName}"]`).first();
    }

    throw new Error("browser_type requires selector, label, placeholder, or name.");
  }
}
