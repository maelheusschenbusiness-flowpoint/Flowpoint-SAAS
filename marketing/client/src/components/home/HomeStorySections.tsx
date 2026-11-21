import { useEffect, useRef, useState } from "react";
import { MotionConfig, motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  FileCheck2,
  Gauge,
  Globe2,
  LockKeyhole,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
} from "lucide-react";
import { trackEvent, trackSignupCta } from "@/lib/analytics";
import "./home-story.css";

const signupUrl = "https://app.flowpoint.pro/signin.html";

const productTabs = [
  {
    id: "overview",
    label: "SEO & overview",
    eyebrow: "THE BIG PICTURE",
    title: "Know where you stand.",
    body: "Review your SEO score, recent activity and website signals in one connected view.",
    benefit: "Start with a clear view of what needs attention.",
    cta: "Explore SEO audits",
    href: "/seo-audit",
    icon: Search,
  },
  {
    id: "monitoring",
    label: "Website monitoring",
    eyebrow: "SITE HEALTH",
    title: "Keep an eye on your website.",
    body: "Bring uptime checks and website status into your team's daily working view.",
    benefit: "Review incidents alongside your other digital signals.",
    cta: "Explore monitoring",
    href: "/website-monitoring",
    icon: Activity,
  },
  {
    id: "competitors",
    label: "Competitor context",
    eyebrow: "LOCAL COMPETITION",
    title: "Put your visibility in context.",
    body: "Compare local search signals and review the businesses competing for your customers' attention.",
    benefit: "Understand the market before choosing your next move.",
    cta: "Explore competitor analysis",
    href: "/competitor-analysis",
    icon: Users,
  },
  {
    id: "opportunities",
    label: "Growth opportunities",
    eyebrow: "QUICK WINS",
    title: "Find a useful place to start.",
    body: "Review suggested improvements and decide which opportunities fit your business priorities.",
    benefit: "Turn a long list of signals into a focused review.",
    cta: "Discover FlowPoint",
    href: signupUrl,
    icon: Target,
  },
  {
    id: "insights",
    label: "AI recommendations",
    eyebrow: "CONNECTED INSIGHTS",
    title: "Give your data some direction.",
    body: "Use AI-assisted insights to bring website, visibility and business activity into focus. FlowPoint can suggest and organize next steps; your team reviews each recommendation and decides what fits.",
    benefit: "AI supports the review. Your team makes the call.",
    cta: "Explore AI insights",
    href: signupUrl,
    icon: Sparkles,
  },
  {
    id: "missions",
    label: "Missions & priorities",
    eyebrow: "REVIEWED WORK",
    title: "Turn findings into focused work.",
    body: "Organize recommendations as missions, assign ownership and keep progress visible to your team.",
    benefit: "Make the next useful action easy to own.",
    cta: "See how missions work",
    href: "/seo-reporting",
    icon: Target,
  },
];

const sectionMotion = {
  initial: { opacity: 1, y: 28, scale: 0.985 },
  whileInView: { opacity: 1, y: 0, scale: 1 },
  viewport: { once: true, amount: 0.08 },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
};

const lenses = [
  {
    label: "Analysis role",
    title: "Find the signal.",
    detail: "Review website health, search and performance signals.",
    icon: Search,
    color: "blue",
  },
  {
    label: "Strategy role",
    title: "Choose what matters.",
    detail: "Prioritize opportunities against business goals.",
    icon: Target,
    color: "blue",
  },
  {
    label: "Action role",
    title: "Make progress visible.",
    detail: "Prepare a mission your team can review and own.",
    icon: Workflow,
    color: "blue",
  },
];

const workflowSteps = [
  {
    id: "signal",
    group: "STARTING SIGNAL",
    title: "A visibility dip appears",
    detail: "An audit or monitoring signal gives your team a reason to look closer. Signals are prompts for review, not automatic diagnoses.",
    icon: Activity,
  },
  {
    id: "inspect",
    group: "ANALYSIS",
    title: "Inspect affected pages",
    detail: "Review the relevant pages, performance context and search data to understand the likely issue.",
    icon: Eye,
  },
  {
    id: "decide",
    group: "DECISION",
    title: "Choose a path forward",
    detail: "Separate a technical issue from a growth opportunity, then decide which recommendation fits your goals.",
    icon: CircleDot,
  },
  {
    id: "mission",
    group: "REVIEWED TASK",
    title: "Create a mission",
    detail: "Turn an approved recommendation into a tracked task for a person or advising team to carry out.",
    icon: FileCheck2,
  },
  {
    id: "measure",
    group: "FOLLOW-THROUGH",
    title: "Review what changed",
    detail: "Return to the relevant signals and reporting to assess progress. Outcomes depend on the work and market.",
    icon: BarChart3,
  },
];

const growthSteps = [
  workflowSteps[0],
  { ...workflowSteps[1], title: "Review keywords & competitors", detail: "Compare search terms and competitor context to identify an opportunity worth exploring." },
  { ...workflowSteps[2], title: "Review a strategic recommendation", detail: "Consider an AI-assisted recommendation against your business priorities. Your team decides whether it is relevant." },
  { ...workflowSteps[3], title: "Plan the next action", detail: "Create a reviewed mission, choose an owner and organize the work. Website changes remain your team's responsibility." },
  { ...workflowSteps[4], title: "Measure the relevant signals", detail: "Return to visibility, activity and reporting after the work to review what changed. Results are not guaranteed." },
];

const controlItems = [
  {
    title: "Activity you can review",
    text: "Keep analyses, missions and workspace events visible as work moves forward.",
    icon: Activity,
    tag: "WORKSPACE VISIBILITY",
  },
  {
    title: "Roles for shared work",
    text: "Organize access around your collaborators' responsibilities and review permissions as your team changes.",
    icon: Users,
    tag: "ACCESS",
  },
  {
    title: "People stay in the loop",
    text: "Recommendations can become missions for people to review and carry out—not silent site changes.",
    icon: FileCheck2,
    tag: "HUMAN REVIEW",
  },
  {
    title: "Usage with context",
    text: "Review AI usage and credits alongside the limits included in your subscription.",
    icon: Gauge,
    tag: "PLAN-AWARE",
  },
  {
    title: "Security-minded defaults",
    text: "Role-aware permissions and reviewed actions help keep sensitive work intentional.",
    icon: LockKeyhole,
    tag: "PUBLIC PLATFORM",
  },
  {
    title: "Settings that fit your team",
    text: "Workspace settings and alert preferences help teams shape how they work with FlowPoint.",
    icon: Settings2,
    tag: "CONFIGURATION",
  },
];

const capabilitySignals = [
  { label: "Visibility", icon: Search, tone: "blue" },
  { label: "Site health", icon: Activity, tone: "blue" },
  { label: "Performance", icon: Gauge, tone: "blue" },
  { label: "Next action", icon: Workflow, tone: "blue" },
];

const insightBoardRows = [
  { title: "Refresh a high-traffic service page", signal: "Search visibility · service pages", owner: "SEO lead", initials: "SEO", status: "Ready to review", tone: "review" },
  { title: "Check mobile loading on key pages", signal: "Core Web Vitals · mobile", owner: "Web team", initials: "WEB", status: "In progress", tone: "progress" },
  { title: "Review local listing details", signal: "Local search · business info", owner: "Team", initials: "T", status: "Planned", tone: "planned" },
];

function InsightReviewBoard() {
  return (
    <div className="fp-story-insight-board" role="img" aria-label="Illustrative team board for reviewing FlowPoint recommendations">
      <div className="fp-story-insight-board-head">
        <div>
          <span className="fp-story-insight-board-label"><Sparkles size={13} /> AI-ASSISTED REVIEW</span>
          <b>Team priorities</b>
        </div>
        <span className="fp-story-insight-board-example"><i /> Example board</span>
      </div>
      <div className="fp-story-insight-columns" aria-hidden="true">
        <span>RECOMMENDATION</span><span>RELATED SIGNAL</span><span>OWNER</span><span>STATUS</span>
      </div>
      <div className="fp-story-insight-rows">
        {insightBoardRows.map((item) => (
          <div className="fp-story-insight-row" key={item.title}>
            <span className="fp-story-insight-task"><b>{item.title}</b><small>{item.signal}</small></span>
            <span className="fp-story-insight-signal">{item.signal}</span>
            <span className="fp-story-insight-owner"><i>{item.initials}</i>{item.owner}</span>
            <span className={`fp-story-insight-status ${item.tone}`}>{item.status}</span>
          </div>
        ))}
      </div>
      <div className="fp-story-insight-board-foot">
        <span><Check size={14} /> Recommendations stay subject to team review.</span>
        <span>Illustrative data</span>
      </div>
    </div>
  );
}

function CapabilityMap({ active }: { active: (typeof productTabs)[number] }) {
  if (active.id === "insights") return <InsightReviewBoard />;

  const ActiveIcon = active.icon;
  return (
    <div className="fp-story-map" role="img" aria-label={`${active.label} connected with FlowPoint's other workspace capabilities`}>
      <div className="fp-story-map-head">
        <span><i /> CONNECTED CAPABILITIES</span>
        <span>{active.eyebrow}</span>
      </div>
      <div className="fp-story-map-field" aria-hidden="true">
        <svg className="fp-story-map-lines" viewBox="0 0 600 300" preserveAspectRatio="none">
          <path pathLength="1" className={["overview", "opportunities"].includes(active.id) ? "is-connected" : ""} d="M300 150 C235 110 190 75 116 54" />
          <path pathLength="1" className={active.id === "monitoring" ? "is-connected" : ""} d="M300 150 C365 110 410 75 484 54" />
          <path pathLength="1" className={active.id === "competitors" ? "is-connected" : ""} d="M300 150 C235 190 190 225 116 246" />
          <path pathLength="1" className={["opportunities", "insights", "missions"].includes(active.id) ? "is-connected" : ""} d="M300 150 C365 190 410 225 484 246" />
        </svg>
        {capabilitySignals.map((signal, index) => {
          const Icon = signal.icon;
          return (
            <span className={`fp-story-map-node ${signal.tone} node-${index + 1} ${signal.label === "Next action" ? "is-next" : ""}`} key={signal.label}>
              <Icon size={16} />
              <span>{signal.label}</span>
            </span>
          );
        })}
        <span className="fp-story-map-hub">
          <span><ActiveIcon size={20} /></span>
          <b>FlowPoint</b>
          <small>Shared context</small>
        </span>
      </div>
      <div className="fp-story-map-foot">
        <span>ONE WORKSPACE</span>
        <span>See the connections, choose the next step</span>
      </div>
    </div>
  );
}

function DemoSection() {
  const [activeTab, setActiveTab] = useState(productTabs[0].id);
  const active = productTabs.find((tab) => tab.id === activeTab) ?? productTabs[0];

  return (
    <motion.section {...sectionMotion} className="fp-story-demo" id="platform" aria-labelledby="fp-demo-title">
      <div className="fp-story-shell">
        <div className="fp-story-demo-heading">
          <div>
            <span className="fp-story-kicker"><span /> THE WORKSPACE, AT A GLANCE</span>
            <h2 id="fp-demo-title">Everything your growth needs.<br /><em>In one connected space.</em></h2>
          </div>
          <p>Explore how search, site health, analytics and next steps connect. Choose a capability to see where it fits.</p>
        </div>
        <div className="fp-story-product">
          <div className="fp-story-product-nav" role="tablist" aria-label="Explore FlowPoint features">
            {productTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  id={`fp-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls="fp-product-panel"
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  className={activeTab === tab.id ? "is-active" : ""}
                  onClick={() => {
                    setActiveTab(tab.id);
                    trackEvent("home_product_tab_selected", { feature: tab.id });
                  }}
                  onKeyDown={(event) => {
                    const current = productTabs.findIndex((item) => item.id === activeTab);
                    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                      event.preventDefault();
                      const direction = event.key === "ArrowRight" ? 1 : -1;
                      const next = (current + direction + productTabs.length) % productTabs.length;
                      setActiveTab(productTabs[next].id);
                      document.getElementById(`fp-tab-${productTabs[next].id}`)?.focus();
                    }
                  }}
                >
                  <Icon size={17} />
                  <span>{tab.label}</span>
                  <ChevronRight className="fp-story-tab-arrow" size={15} />
                </button>
              );
            })}
            <div className="fp-story-tab-note"><span className="fp-story-live-dot" /> Six views · one workspace</div>
          </div>
          <div
            className="fp-story-product-panel"
            role="tabpanel"
            id="fp-product-panel"
            aria-labelledby={`fp-tab-${active.id}`}
            data-capability={active.id}
            key={active.id}
          >
            <div className="fp-story-product-copy">
              <span className="fp-story-kicker">{active.eyebrow}</span>
              <h3>{active.title}</h3>
              <p>{active.body}</p>
              <div className="fp-story-benefit"><Check size={16} /><span>{active.benefit}</span></div>
              <a
                className="fp-story-inline-link"
                href={active.href}
                target={active.href === signupUrl ? "_blank" : undefined}
                rel={active.href === signupUrl ? "noopener noreferrer" : undefined}
                onClick={() => {
                  if (active.href === signupUrl) trackSignupCta(`home_tour_${active.id}`);
                }}
              >
                {active.cta}<ArrowUpRight size={15} />
              </a>
            </div>
            <CapabilityMap active={active} />
          </div>
        </div>
        <div className="fp-story-demo-foot">
          <span><ShieldCheck size={15} /> A focused view of tools for local businesses and advising teams.</span>
          <a href="/pricing">Compare plans <ArrowRight size={14} /></a>
        </div>
      </div>
    </motion.section>
  );
}

function LensesSection() {
  const [current, setCurrent] = useState(0);
  const [sequence, setSequence] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const hasAutoPlayed = useRef(false);

  useEffect(() => {
    if (!sequence || !playing) return;
    setCurrent(0);
    timersRef.current = lenses.map((_, index) =>
      window.setTimeout(() => setCurrent(index), 700 + index * 1800),
    );
    timersRef.current.push(window.setTimeout(() => setPlaying(false), 6500));
    return () => timersRef.current.forEach(window.clearTimeout);
  }, [sequence, playing]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !hasAutoPlayed.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        hasAutoPlayed.current = true;
        setCurrent(0);
        setPlaying(true);
        setSequence((value) => value + 1);
      } else if (!entry.isIntersecting) {
        setPlaying(false);
        timersRef.current.forEach(window.clearTimeout);
      }
    }, { threshold: 0.08 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      timersRef.current.forEach(window.clearTimeout);
    };
  }, []);

  const replay = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPlaying(false);
      setCurrent(lenses.length - 1);
      return;
    }
    setCurrent(0);
    setPlaying(true);
    setSequence((value) => value + 1);
  };

  return (
    <motion.section {...sectionMotion} className="fp-story-lenses" aria-labelledby="fp-lenses-title">
      <div className="fp-story-shell fp-story-lenses-layout">
        <div className="fp-story-lenses-copy">
          <span className="fp-story-kicker"><span /> AI-ASSISTED, HUMAN-GUIDED</span>
          <h2 id="fp-lenses-title">Three connected roles.<br /><em>One FlowPoint workspace.</em></h2>
          <p>AI can help surface patterns and organize possible next steps. People bring the business context, review the suggestions and decide what deserves action.</p>
          <ul className="fp-story-checklist">
            <li><Check size={16} /> Cross-check the signals that matter</li>
            <li><Check size={16} /> Prioritize with business context</li>
            <li><Check size={16} /> Keep people involved in the next step</li>
          </ul>
          <a className="fp-story-primary" href={signupUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackSignupCta("home_lenses")}>
            Discover FlowPoint <ArrowRight size={16} />
          </a>
        </div>
        <div ref={rootRef} className={`fp-story-orchestra ${playing ? "is-playing" : ""}`} role="group" aria-labelledby="fp-roles-workflow-title">
          <div className="fp-story-orchestra-head">
            <div><span className="fp-story-kicker">ILLUSTRATIVE WORKFLOW</span><h3 id="fp-roles-workflow-title">From signal to next step</h3></div>
            <button className="fp-story-replay" type="button" onClick={replay} aria-label="Replay">
              <RefreshCw size={14} /> Replay
            </button>
          </div>
          <div className="fp-story-question"><Sparkles size={16} /><span>Where should we focus next?</span><small>Example request</small></div>
          <div className={`fp-story-lens-list ${playing ? "is-playing" : ""}`}>
            {lenses.map((lens, index) => {
              const Icon = lens.icon;
              return (
                <button
                  type="button"
                  className={`fp-story-lens ${lens.color} ${current === index ? "is-selected" : ""} ${current >= index && playing ? "is-complete" : ""}`}
                  key={lens.label}
                  aria-pressed={current === index}
                  onClick={() => { setPlaying(false); timersRef.current.forEach(window.clearTimeout); setCurrent(index); }}
                  onMouseEnter={() => { if (!playing) setCurrent(index); }}
                  onFocus={() => { if (!playing) setCurrent(index); }}
                >
                  <span className="fp-story-lens-icon"><Icon size={18} /></span>
                  <span className="fp-story-lens-text"><b>{lens.label}</b><small>{lens.title} {lens.detail}</small></span>
                  <span className="fp-story-lens-check"><Check size={13} /></span>
                </button>
              );
            })}
          </div>
          <div className="fp-story-consolidated">
            <div className="fp-story-orbit"><span /><span /><span /><Sparkles size={18} /></div>
            <div aria-live="polite"><small>FLOWPOINT WORKSPACE · HUMAN REVIEW REQUIRED</small><b>{playing ? ["Reviewing website and search signals…", "Prioritizing against business goals…", "Preparing a mission for review…"][current] : "Recommendation for human review"}</b></div>
            <ChevronRight size={17} />
          </div>
          <p className="fp-story-illustration-note">Illustrative role-based workflow. Model assignments are not shown; your team decides whether to act.</p>
        </div>
      </div>
    </motion.section>
  );
}

function WorkflowSection() {
  const [selected, setSelected] = useState("signal");
  const [branch, setBranch] = useState<"technical" | "growth">("technical");
  const [railVisible, setRailVisible] = useState(false);
  const flowRef = useRef<HTMLElement>(null);
  const steps = branch === "technical" ? workflowSteps : growthSteps;
  const selectedStep = steps.find((step) => step.id === selected) ?? steps[0];

  useEffect(() => {
    const node = flowRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setRailVisible(entry.isIntersecting);
    }, { threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.section {...sectionMotion} ref={flowRef} className={`fp-story-flow ${railVisible ? "is-in-view" : ""}`} aria-labelledby="fp-flow-title">
      <div className="fp-story-shell">
        <div className="fp-story-flow-header">
          <div><span className="fp-story-kicker"><span /> THE ROUTE FROM INSIGHT TO PROGRESS</span>
            <h2 id="fp-flow-title">Your data becomes a decision.<br /><em>Your decision becomes a next step.</em></h2>
          </div>
          <p>One example of how a team can move from a search signal to a reviewed task and a follow-up check.</p>
        </div>
        <div className="fp-story-flow-canvas">
          <div className="fp-story-flow-rail" aria-hidden="true"><span /></div>
          <div className="fp-story-flow-nodes">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`fp-story-flow-node ${selected === step.id ? "is-selected" : ""}`}
                  aria-pressed={selected === step.id}
                  aria-describedby={selected === step.id ? "fp-flow-explanation" : undefined}
                  onClick={() => setSelected(step.id)}
                  onMouseEnter={() => setSelected(step.id)}
                  onFocus={() => setSelected(step.id)}
                  title={step.detail}
                >
                  <span className="fp-story-flow-number">0{index + 1}</span>
                  <span className="fp-story-flow-icon"><Icon size={18} /></span>
                  <span className="fp-story-flow-group">{step.group}</span>
                  <b>{step.title}</b>
                  {index < steps.length - 1 && <span className="fp-story-flow-link" aria-hidden="true"><ArrowRight size={14} /></span>}
                </button>
              );
            })}
          </div>
          <div className="fp-story-flow-detail" id="fp-flow-explanation" aria-live="polite">
            <span className="fp-story-detail-mark"><selectedStep.icon size={17} /></span>
            <div><small>{selectedStep.group} / STEP {String(steps.findIndex((step) => step.id === selected) + 1).padStart(2, "0")}</small><p>{selectedStep.detail}</p></div>
            <span className="fp-story-detail-label">Select a step to explore</span>
          </div>
          <div className="fp-story-branches" role="group" aria-label="Choose an example workflow">
            <button type="button" aria-pressed={branch === "technical"} onClick={() => setBranch("technical")}><span className="fp-story-branch-dot technical" /><b>Technical issue</b><span>Review pages → prioritize fixes → create a mission → check progress</span></button>
            <button type="button" aria-pressed={branch === "growth"} onClick={() => setBranch("growth")}><span className="fp-story-branch-dot growth" /><b>Growth opportunity</b><span>Review keywords → shape a recommendation → plan work → measure signals</span></button>
          </div>
          <p className="fp-story-flow-note">Recommendations and missions support people doing the work; FlowPoint does not silently make changes to your website.</p>
        </div>
      </div>
    </motion.section>
  );
}

function HowItWorksSection() {
  const steps = [
    { number: "01", icon: Globe2, title: "Connect your business", text: "Create your account, set up your workspace and add your website plus any services you want to use." },
    { number: "02", icon: Search, title: "Let FlowPoint analyze", text: "Explore performance, issues and opportunities through clear, connected views." },
    { number: "03", icon: ArrowUpRight, title: "Choose what to do next", text: "Review recommendations, organize missions and check your progress over time." },
  ];
  return (
    <motion.section {...sectionMotion} id="how-it-works" className="fp-story-how" aria-labelledby="fp-how-title">
      <div className="fp-story-shell">
        <div className="fp-story-how-head">
          <div><span className="fp-story-kicker"><span /> A SIMPLE START</span><h2 id="fp-how-title">How FlowPoint works</h2></div>
          <p>From connecting your activity to deciding what deserves attention—without needing to be an SEO specialist.</p>
        </div>
        <div className="fp-story-how-steps">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return <article className="fp-story-how-step" key={step.number}>
              <span className="fp-story-how-number">{step.number}<i /></span>
              <span className="fp-story-how-icon"><Icon size={20} /></span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              {index < steps.length - 1 && <ChevronRight className="fp-story-how-arrow" size={18} aria-hidden="true" />}
            </article>;
          })}
        </div>
        <div className="fp-story-how-cta">
          <span>Start with your website. Grow from what you learn.</span>
          <a className="fp-story-primary" href={signupUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackSignupCta("home_how_it_works")}>
            Get started <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </motion.section>
  );
}

function ControlAndTrustSection() {
  const [trustVisible, setTrustVisible] = useState(false);
  const trustRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = trustRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setTrustVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.12 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <motion.section {...sectionMotion} className="fp-story-control" aria-labelledby="fp-control-title">
        <div className="fp-story-shell">
          <div className="fp-story-control-head">
            <span className="fp-story-kicker"><span /> PEOPLE IN CONTROL</span>
            <h2 id="fp-control-title">Useful intelligence.<br /><em>Clear human ownership.</em></h2>
            <p>FlowPoint helps teams see, discuss and organize the work. Your people remain responsible for decisions and changes.</p>
          </div>
          <div className="fp-story-control-grid">
            {controlItems.map((item, index) => {
              const Icon = item.icon;
              return <article className="fp-story-control-item" key={item.title}>
                <span className="fp-story-control-index">0{index + 1}</span>
                <span className="fp-story-control-icon"><Icon size={19} /></span>
                <span className="fp-story-control-tag">{item.tag}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>;
            })}
          </div>
        </div>
      </motion.section>
      <motion.section {...sectionMotion} ref={trustRef} className={`fp-story-trust ${trustVisible ? "is-in-view" : ""}`} aria-labelledby="fp-trust-title">
        <div className="fp-story-shell fp-story-trust-layout">
          <div className="fp-story-trust-main">
            <div className="fp-story-trust-emblem"><ShieldCheck size={25} /><span>SECURITY & TRUST</span></div>
            <span className="fp-story-kicker">BUILT FOR PROFESSIONAL WORK</span>
            <h2 id="fp-trust-title">Your data deserves<br />serious protection.</h2>
            <p>A professional workspace needs clear access rules and practical safeguards. Explore the controls and policies behind FlowPoint.</p>
            <div className="fp-story-trust-facts">
              <div><LockKeyhole size={17} /><span><b>HTTPS-first connections</b><small>Production HSTS instructs browsers to use HTTPS.</small></span></div>
              <div><ShieldCheck size={17} /><span><b>Public endpoint protections</b><small>Contact and lead endpoints apply request limits.</small></span></div>
            </div>
            <div className="fp-story-trust-diagram" role="img" aria-label="Trust layers: FlowPoint workspace, access and roles, HTTPS connections, endpoint protections and monitoring">
              <svg className="fp-trust-ring-traces" viewBox="0 0 286 286" aria-hidden="true">
                <circle className="trace-three" cx="143" cy="143" r="129" pathLength="1" />
                <circle className="trace-two" cx="143" cy="143" r="104" pathLength="1" />
                <circle className="trace-one" cx="143" cy="143" r="76" pathLength="1" />
              </svg>
              <div className="fp-trust-ring ring-three"><span>ENDPOINT PROTECTIONS · MONITORING</span></div>
              <div className="fp-trust-ring ring-two"><span>HTTPS CONNECTIONS</span></div>
              <div className="fp-trust-ring ring-one"><span>ACCESS & ROLES</span></div>
              <div className="fp-trust-core"><ShieldCheck size={18} /><b>FlowPoint</b><small>workspace</small></div>
            </div>
          </div>
          <div className="fp-story-trust-side">
            <article><span className="fp-story-trust-card-icon"><Users size={18} /></span><div><h3>Access & roles</h3><p>Organize shared work with role-aware permissions. Review your workspace's access settings when inviting collaborators.</p></div></article>
            <article><span className="fp-story-trust-card-icon violet"><Eye size={18} /></span><div><h3>Privacy, in plain language</h3><p>Review the published privacy information and terms to understand how FlowPoint describes its data practices.</p></div></article>
            <article><span className="fp-story-trust-card-icon cyan"><Clock3 size={18} /></span><div><h3>Monitoring & follow-up</h3><p>Review website monitoring signals and recorded activity. Our service terms explain availability commitments and their scope.</p></div></article>
            <div className="fp-story-legal-links">
              <a href="/legal-information#confidentialite">Privacy policy <ArrowUpRight size={13} /></a>
              <a href="/legal-information#cgu">Terms of use <ArrowUpRight size={13} /></a>
              <a href="/legal-notice">Legal notice <ArrowUpRight size={13} /></a>
            </div>
          </div>
        </div>
      </motion.section>
    </>
  );
}

export function HomeStorySections() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="fp-home-story">
        <DemoSection />
        <LensesSection />
        <WorkflowSection />
        <HowItWorksSection />
        <ControlAndTrustSection />
      </div>
    </MotionConfig>
  );
}
