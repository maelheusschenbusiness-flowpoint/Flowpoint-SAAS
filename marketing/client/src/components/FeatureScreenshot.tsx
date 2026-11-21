import { useEffect, useRef, useState } from "react";

type FeatureScreenshotProps = {
  route:
    | "local-seo"
    | "monitors"
    | "competitor"
    | "technical-audit"
    | "audits"
    | "missions"
    | "reports"
    | "overview"
    | "monitors"
    | "local-seo/competitors"
    | "overview/quick-wins"
    | "overview/insights";
  alt: string;
};

const FRAME_WIDTH = 1440;
const FRAME_HEIGHT = 810;

export function FeatureScreenshot({
  route,
  alt,
}: FeatureScreenshotProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const update = () => {
      setFrameWidth(frameRef.current?.clientWidth || 0);
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    if (frameRef.current) resizeObserver.observe(frameRef.current);
    const themeObserver = new MutationObserver(update);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  const scale = frameWidth > 0 ? frameWidth / FRAME_WIDTH : 1;
  // Marketing dashboard captures stay in English, regardless of stale language cookies.
  const previewUrl = `/dashboard-preview/dashboard.html?lang=en&theme=${theme}#${route}`;

  return (
    <figure
      tabIndex={0}
      title="Hover to zoom in"
      className="feature-screenshot-zoom relative z-0 rounded-2xl focus-visible:z-30 focus-visible:outline-none hover:z-30"
    >
      <div
        ref={frameRef}
        className="feature-screenshot-frame relative aspect-[1800/1013] w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700"
      >
        <iframe
          src={previewUrl}
          title={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts"
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT,
            transform: `scale(${scale})`,
          }}
        />
      </div>
    </figure>
  );
}
