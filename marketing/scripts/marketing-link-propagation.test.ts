import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { addFunnelAttributionToSignupLink, installMarketingAppLinkPropagation } from "../client/src/lib/funnel-tracking";

type GlobalSnapshot = Record<string, PropertyDescriptor | undefined>;
const globalNames = ["window", "document", "Element", "HTMLAnchorElement", "MutationObserver"] as const;
const originalGlobals: GlobalSnapshot = Object.fromEntries(
  globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
);

class FakeElement {
  closest<T extends Element>(_selector: string): T | null {
    return this as unknown as T;
  }
}

class FakeAnchor extends FakeElement {
  private currentHref: string;
  writes = 0;

  constructor(href: string) {
    super();
    this.currentHref = href;
  }

  get href(): string {
    return new URL(this.currentHref, "https://flowpoint.pro/").toString();
  }

  set href(value: string) {
    const oldValue = this.currentHref;
    this.currentHref = new URL(value, "https://flowpoint.pro/").toString();
    this.writes += 1;
    FakeMutationObserver.instance?.queue({
      type: "attributes",
      target: this as unknown as Node,
      attributeName: "href",
      oldValue,
      addedNodes: [] as unknown as NodeList,
    } as MutationRecord);
  }

  getAttribute(name: string): string | null {
    return name === "href" ? this.currentHref : null;
  }
}

class FakeMutationObserver {
  static instance: FakeMutationObserver | null = null;
  private records: MutationRecord[] = [];

  constructor(private readonly callback: MutationCallback) {
    FakeMutationObserver.instance = this;
  }

  observe(): void {}
  disconnect(): void {}
  takeRecords(): MutationRecord[] {
    const current = this.records;
    this.records = [];
    return current;
  }
  queue(record: MutationRecord): void {
    this.records.push(record);
  }
  flush(): void {
    const records = this.takeRecords();
    if (records.length) this.callback(records, this as unknown as MutationObserver);
  }
}

function createFakeBrowser(consent: "accepted" | "refused") {
  const localValues = new Map<string, string>([["cookie_consent", consent]]);
  const sessionValues = new Map<string, string>();
  const windowListeners = new Map<string, Set<EventListener>>();
  const documentListeners = new Map<string, Set<EventListener>>();
  const anchor = new FakeAnchor("https://app.flowpoint.pro/signin.html?plan=pro");

  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: (key: string) => localValues.delete(key),
    },
    sessionStorage: {
      getItem: (key: string) => sessionValues.get(key) ?? null,
      setItem: (key: string, value: string) => sessionValues.set(key, value),
      removeItem: (key: string) => sessionValues.delete(key),
    },
    location: {
      search: "?lang=en",
      origin: "https://flowpoint.pro",
      hostname: "flowpoint.pro",
      protocol: "https:",
      href: "https://flowpoint.pro/pricing?lang=en",
    },
    addEventListener: (type: string, listener: EventListener) => {
      const listeners = windowListeners.get(type) || new Set<EventListener>();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      windowListeners.get(type)?.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      for (const listener of windowListeners.get(event.type) || []) listener(event);
      return true;
    },
  };

  const fakeDocument = {
    cookie: "",
    referrer: "",
    documentElement: { lang: "en", dataset: { language: "en" } },
    body: {},
    querySelectorAll: () => [anchor],
    addEventListener: (type: string, listener: EventListener) => {
      const listeners = documentListeners.get(type) || new Set<EventListener>();
      listeners.add(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      documentListeners.get(type)?.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      for (const listener of documentListeners.get(event.type) || []) listener(event);
      return true;
    },
  };

  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: FakeElement });
  Object.defineProperty(globalThis, "HTMLAnchorElement", { configurable: true, value: FakeAnchor });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: FakeMutationObserver,
  });

  return {
    anchor,
    fakeDocument: fakeDocument as unknown as Document,
    fakeWindow: fakeWindow as unknown as Window,
    localValues,
    documentListeners,
  };
}

afterEach(() => {
  FakeMutationObserver.instance = null;
  for (const name of globalNames) {
    const descriptor = originalGlobals[name];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("reapplying attribution produces the same href without another write", () => {
  const { anchor } = createFakeBrowser("refused");

  addFunnelAttributionToSignupLink(anchor as unknown as HTMLAnchorElement);
  const firstHref = anchor.href;
  addFunnelAttributionToSignupLink(anchor as unknown as HTMLAnchorElement);

  assert.equal(anchor.href, firstHref);
  assert.equal(anchor.writes, 1);
});

test("the href mutation from propagation is ignored by its observer", () => {
  const { anchor, fakeDocument, fakeWindow, localValues } = createFakeBrowser("refused");
  let updates = 0;
  const cleanup = installMarketingAppLinkPropagation(
    fakeDocument,
    (link) => {
      updates += 1;
      addFunnelAttributionToSignupLink(link);
    },
  );

  FakeMutationObserver.instance?.flush();
  assert.equal(updates, 1, "initial propagation runs once");

  localValues.set("cookie_consent", "accepted");
  fakeWindow.dispatchEvent(new Event("flowpoint-cookie-consent-change"));
  const acceptedHref = new URL(anchor.href);
  assert.ok(acceptedHref.searchParams.get("fp_vid"));
  assert.equal(updates, 2, "consent change propagates once");

  FakeMutationObserver.instance?.flush();
  assert.equal(updates, 2, "the self-generated href mutation is not processed again");
  cleanup();
});
