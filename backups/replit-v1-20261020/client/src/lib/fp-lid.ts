const APP_ORIGIN = "https://app.flowpoint.pro";
const FP_LID_STORAGE_KEY = "flowpoint:marketing:fp_lid";
const FP_LID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isValidFpLid(value: string | null | undefined): value is string {
  return typeof value === "string" && FP_LID_PATTERN.test(value);
}

function clearStoredFpLid() {
  try {
    window.sessionStorage.removeItem(FP_LID_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function getActiveFpLid(): string | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has("fp_lid")) {
    const incomingFpLid = params.get("fp_lid");
    if (!isValidFpLid(incomingFpLid)) {
      clearStoredFpLid();
      return null;
    }

    try {
      window.sessionStorage.setItem(FP_LID_STORAGE_KEY, incomingFpLid);
    } catch {
      // The current page can still use the URL value if storage is unavailable.
    }

    return incomingFpLid;
  }

  try {
    const storedFpLid = window.sessionStorage.getItem(FP_LID_STORAGE_KEY);
    if (!isValidFpLid(storedFpLid)) {
      clearStoredFpLid();
      return null;
    }

    const referrer = document.referrer ? new URL(document.referrer) : null;
    if (referrer?.origin === window.location.origin) {
      return storedFpLid;
    }
  } catch {
    // Without a same-site referrer, do not reuse an earlier attribution value.
  }

  clearStoredFpLid();
  return null;
}

export function addFpLidToAppUrl(href: string, fpLid: string | null): string {
  if (!isValidFpLid(fpLid)) {
    return href;
  }

  try {
    const url = new URL(href);
    if (url.origin !== APP_ORIGIN) {
      return href;
    }

    url.searchParams.set("fp_lid", fpLid);
    return url.toString();
  } catch {
    return href;
  }
}

export function installFpLidPropagation(
  fpLid: string | null,
  targetDocument?: Document,
): () => void {
  const pageDocument =
    targetDocument ?? (typeof document === "undefined" ? null : document);
  if (!pageDocument || !isValidFpLid(fpLid)) {
    return () => {};
  }

  const updateAppLink = (anchor: HTMLAnchorElement) => {
    const updatedHref = addFpLidToAppUrl(anchor.href, fpLid);
    if (updatedHref !== anchor.href) {
      anchor.href = updatedHref;
    }
  };

  pageDocument
    .querySelectorAll<HTMLAnchorElement>("a[href]")
    .forEach(updateAppLink);

  const handleLinkActivation = (event: Event) => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") {
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (anchor) {
      updateAppLink(anchor);
    }
  };

  pageDocument.addEventListener("click", handleLinkActivation, true);
  pageDocument.addEventListener("auxclick", handleLinkActivation, true);

  return () => {
    pageDocument.removeEventListener("click", handleLinkActivation, true);
    pageDocument.removeEventListener("auxclick", handleLinkActivation, true);
  };
}
