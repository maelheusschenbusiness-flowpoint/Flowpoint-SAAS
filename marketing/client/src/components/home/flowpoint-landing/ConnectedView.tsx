import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Activity, Check, CheckCircle2, Database, FileDown, Globe2, LockKeyhole, Pause, Play, ShieldCheck, Sparkles, UsersRound } from "lucide-react";

const signals = [
  { name: "Search", source: "Local visibility", icon: Globe2, title: "Understand how people find you", subtitle: "Search visibility · illustrative trend", insight: "Find the gaps in your visibility.", description: "Bring search and local listing signals together to spot pages and business details worth reviewing.", next: "Review the search terms and listing details behind a change.", note: "Connected context, not another isolated report.", path: "M0 128 C30 123 43 132 65 112 S100 119 125 94 S160 101 185 79 S220 85 245 65 S280 73 305 44 S340 55 365 28 S395 35 420 17" },
  { name: "Website", source: "Health & performance", icon: Activity, title: "See what needs a closer look", subtitle: "Website health · illustrative trend", insight: "Turn technical signals into a next step.", description: "Review website health and performance in context, with AI-supported suggestions your team can assess.", next: "Check affected pages and prioritize the issue that matters.", note: "Performance and website health, in the same view.", path: "M0 108 C28 104 46 114 65 91 S100 111 125 84 S160 92 185 53 S220 66 245 44 S280 53 305 31 S340 44 365 19 S395 24 420 12" },
  { name: "Analytics", source: "Audience & journeys", icon: UsersRound, title: "Connect activity to the bigger picture", subtitle: "Audience activity · illustrative trend", insight: "Look beyond the headline numbers.", description: "Explore audience activity and journeys alongside website and search signals, instead of switching between reports.", next: "Review the journey and decide what to investigate next.", note: "Your team reviews the recommendation before acting.", path: "M0 133 C28 126 46 114 65 119 S100 82 125 98 S160 57 185 73 S220 39 245 65 S280 29 305 43 S340 18 365 32 S395 22 420 10" },
];

export function ConnectedView() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = window.setInterval(() => setActive(value => (value + 1) % signals.length), 6500);
    return () => window.clearInterval(timer);
  }, [playing, reducedMotion]);
  const signal = signals[active];
  return (
    <div className="fp2-signal-section">
      <div className="fp2-signal-heading">
        <div><span className="fp2-signal-eyebrow"><i /> A connected view</span><h2>From scattered signals<br />to a clearer next step.</h2></div>
        <p>Your data brings the context. AI helps connect the dots. You decide what happens next.</p>
      </div>
      <div className="fp2-signal-console">
        <div className="fp2-console-bar"><div className="fp2-console-name"><span><Sparkles size={16} /></span><div><b>FlowPoint intelligence</b><small>Signals → context → next steps</small></div></div><span className="fp2-live-state"><i /> INTERACTIVE PREVIEW</span></div>
        <div className="fp2-signal-body">
          <div className="fp2-signal-sources" role="tablist" aria-label="Explore connected signals">
            <p className="fp2-console-label">Connected signals</p>
            {signals.map((item, index) => <button type="button" role="tab" id={`fp2-signal-tab-${index}`} aria-selected={active === index} aria-controls="fp2-signal-content" className="fp2-source-button" key={item.name} onClick={() => { setActive(index); setPlaying(false); }}><item.icon /><span>{item.name}<small>{item.source}</small></span></button>)}
            <p className="fp2-source-foot"><Database size={13} /> One shared workspace.<br />A more complete picture.</p>
          </div>
          <div className="fp2-signal-chart-panel" role="tabpanel" id="fp2-signal-content" aria-labelledby={`fp2-signal-tab-${active}`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={active} initial={{opacity:0,y:7}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}} transition={{duration:reducedMotion ? 0 : .3}}>
                <div className="fp2-chart-heading"><div><h3>{signal.title}</h3><p>{signal.subtitle}</p></div><span className="fp2-demo-pill">DEMO</span></div>
                <div className="fp2-animated-chart"><svg viewBox="0 0 420 155" preserveAspectRatio="none" role="img" aria-label={signal.subtitle}><path d={`${signal.path} L420 155 L0 155Z`} fill="url(#fp2-signal-fill)" /><defs><linearGradient id="fp2-signal-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6a91f6" stopOpacity=".22" /><stop offset="100%" stopColor="#6a91f6" stopOpacity="0" /></linearGradient></defs><motion.path d={signal.path} fill="none" stroke="#82a6ff" strokeWidth="3" style={{transformOrigin:"0% 100%"}} initial={{scaleX:reducedMotion ? 1 : 0,opacity:reducedMotion ? 1 : 0}} animate={{scaleX:1,opacity:1}} transition={{duration:reducedMotion ? 0 : 1.1,ease:"easeInOut"}} /><motion.circle cx="420" cy={active === 0 ? 17 : active === 1 ? 12 : 10} r="4" fill="#c5d6ff" initial={{opacity:0}} animate={{opacity:1}} transition={{delay:reducedMotion ? 0 : 1.2}} /></svg></div>
                <div className="fp2-chart-caption"><span>EARLIER</span><span>ILLUSTRATIVE DATA · NOT CUSTOMER RESULTS</span><span>NOW</span></div>
                <div className="fp2-chart-note"><CheckCircle2 size={14} />{signal.note}</div>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="fp2-insight-panel"><div className="fp2-insight-icon"><Sparkles size={18} /></div><div><p className="fp2-console-label">AI-supported insight</p><AnimatePresence mode="wait" initial={false}><motion.div key={active} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:reducedMotion ? 0 : .25}}><h3>{signal.insight}</h3><p>{signal.description}</p></motion.div></AnimatePresence></div><div className="fp2-insight-next"><small>SUGGESTED NEXT STEP</small><b>{signal.next}</b></div></div>
        </div>
        <div className="fp2-console-footer"><span><ShieldCheck size={15} />AI-supported recommendations. Human-led decisions.</span><button type="button" className="fp2-demo-toggle" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={12} /> : <Play size={12} />}{playing ? "Pause preview" : "Play preview"}</button></div>
      </div>
    </div>
  );
}

const controls = [
  { icon: LockKeyhole, title: "Context-aware access", description: "Server-side sessions, organization-scoped data and role-based permission checks." },
  { icon: ShieldCheck, title: "Rate limits & safeguards", description: "Organization-level AI rate limits and production security headers, including CSP and HSTS." },
  { icon: Activity, title: "Tracked actions", description: "Tool proposals and actions are logged. Write actions may require confirmation, depending on settings." },
  { icon: FileDown, title: "Controlled exports", description: "PDF and JSON exports are limited to owners and admins. JSON excludes credentials, payment details, private attachments and AI prompts." },
];

export function SecurityControls() {
  return <div className="fp2-security-refresh">
    <div><span className="fp2-signal-eyebrow">Security & privacy</span><h2 id="fp2-premium-security-title">Clear access controls.<br /><em>Activity you can review.</em></h2><p>Workspace permissions, logged tool actions and controlled exports help your team manage access to its data.</p><div className="fp2-security-copy-foot"><ShieldCheck size={17} /><span>Clear responsibilities, controlled access.<br />Your workspace stays under your team’s control.</span></div></div>
    <div className="fp2-security-table"><div className="fp2-security-table-head"><ShieldCheck size={23} /><div><small>WORKSPACE SAFEGUARDS</small><b>Access, activity & exports</b></div></div>{controls.map(item => <div className="fp2-security-control" key={item.title}><item.icon /><div><h3>{item.title}</h3><p>{item.description}</p></div><Check /></div>)}<div className="fp2-security-table-note">Some AI requests send the selected provider the prompt and context needed for the task. Exported usage metrics may be included.</div></div>
  </div>;
}
