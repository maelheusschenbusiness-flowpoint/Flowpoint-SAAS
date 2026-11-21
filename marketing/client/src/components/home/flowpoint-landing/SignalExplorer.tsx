import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Activity, ArrowDownRight, CheckCircle2, Database, Globe2, Pause, Play, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import "./SignalExplorer.css";

const signals = [
  { name:"Search", source:"Local visibility", icon:Globe2, title:"Your visibility, neighbourhood by neighbourhood.", subtitle:"Local search · ranking coverage", insight:"Find the gaps around you.", description:"A local view makes uneven visibility easier to spot. Compare nearby areas before deciding which listing or page needs attention.", next:"Review the lower-ranking locations and their listing details.", note:"Select a tile to inspect a sample location." },
  { name:"Website", source:"Health & performance", icon:Activity, title:"Healthy overall. One thing to investigate.", subtitle:"Website health · service diagnostics", insight:"Prioritise the outlier, not the noise.", description:"Availability and page speed tell different stories. Keep healthy services in view while investigating the page that needs a closer look.", next:"Check the contact page’s mobile loading performance.", note:"Each segment represents an illustrative service check." },
  { name:"Analytics", source:"Audience & journeys", icon:UsersRound, title:"See where attention becomes action.", subtitle:"Audience journeys · conversion funnel", insight:"The middle of the journey matters.", description:"Visits are only the beginning. Follow the path from discovery to a service page, then to an enquiry, to see where people drop away.", next:"Review the service-to-enquiry step before changing acquisition.", note:"Illustrative journey, not measured customer results." },
];
const ranks = [3,2,4,6,8,9,12,14,16,2,1,3,5,7,8,9,12,13,1,2,2,4,6,7,8,10,12,2,3,4,5,5,6,9,11,14,4,4,5,6,7,9,11,13,17];
const locations = ["North quarter", "Central district", "Riverside", "Old town", "South quarter"];

export function SignalExplorer() {
  // Keep the server and first client render identical. Browser preferences and
  // deep links are progressive enhancements applied only after hydration.
  const [active,setActive] = useState(0);
  const [playing,setPlaying] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("signal");
    setActive(requested === "website" ? 1 : requested === "analytics" ? 2 : 0);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPlaying(!params.has("signal") && !prefersReducedMotion);
  }, []);
  const [tile,setTile] = useState(20);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setActive(value => (value + 1) % signals.length), 6000);
    return () => window.clearInterval(timer);
  },[playing]);
  const signal = signals[active];
  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    setActive(value => (value + 1) % signals.length);
    setPlaying(true);
  };
  return <div className="fp2-signal-section fp2-explorer" data-signal={active} id="connected-preview">
    <div className="fp2-signal-heading"><div><span className="fp2-signal-eyebrow"><i /> A connected view</span><h2>From scattered signals<br />to a clearer next step.</h2></div><p>Your data brings the context. AI helps connect the dots. You decide what happens next.</p></div>
    <div className="fp2-signal-console">
      <div className="fp2-console-bar"><div className="fp2-console-name"><span><Sparkles size={16} /></span><div><b>FlowPoint intelligence</b><small>Signals → context → next steps</small></div></div><span className="fp2-live-state"><i /> INTERACTIVE PREVIEW</span></div>
      <div className="fp2-signal-body">
        <div className="fp2-signal-sources" role="tablist" aria-label="Explore connected signals">
          <p className="fp2-console-label">Connected signals</p>
          {signals.map((item,index) => <button type="button" role="tab" id={`fp2-explorer-tab-${index}`} aria-selected={active===index} aria-controls="fp2-explorer-content" className="fp2-source-button" key={item.name} onClick={() => {setActive(index);setPlaying(false);}} onKeyDown={event => { if(event.key==="ArrowDown" || event.key==="ArrowRight" || event.key==="ArrowUp" || event.key==="ArrowLeft"){event.preventDefault();const next=(index+(event.key==="ArrowDown"||event.key==="ArrowRight"?1:2))%3;setActive(next);setPlaying(false);document.getElementById(`fp2-explorer-tab-${next}`)?.focus();}}}><item.icon /><span>{item.name}<small>{item.source}</small></span></button>)}
          <p className="fp2-source-foot"><Database size={13} /> One shared workspace.<br />Three different perspectives.</p>
        </div>
        <div className="fp2-signal-chart-panel" role="tabpanel" id="fp2-explorer-content" aria-labelledby={`fp2-explorer-tab-${active}`}>
          <AnimatePresence mode="wait" initial={false}><motion.div key={active} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:reducedMotion?0:.2}}>
            <div className="fp2-chart-heading"><div><h3>{signal.title}</h3><p>{signal.subtitle}</p></div><span className="fp2-demo-pill">DEMO</span></div>
            <div className="fp2-explorer-visual">
              {active===0 && <><div className="fp2-explorer-kicker"><span>LOCAL RANKING GRID</span><b>45 sample locations</b></div><div className="fp2-visibility-grid" aria-label="Illustrative local ranking grid">{ranks.map((rank,index)=><button key={index} type="button" data-rank={rank<=4?"high":rank<=9?"mid":"low"} aria-label={`${locations[Math.floor(index/9)]}, sample ${index%9+1}, rank ${rank}`} aria-pressed={tile===index} onClick={()=>{setTile(index);setPlaying(false);}}>{rank}</button>)}</div><div className="fp2-grid-detail"><span>{locations[Math.floor(tile/9)]} · Location {tile%9+1}</span><b>Position #{ranks[tile]}</b></div><div className="fp2-grid-legend"><i /> Top 4 <i /> 5–9 <i /> 10+ <span style={{marginLeft:"auto"}}>ILLUSTRATIVE DATA</span></div></>}
              {active===1 && <><div className="fp2-service-summary"><div className="fp2-health-ring"><b>94.6</b></div><div><strong>Website health score</strong><small>Availability looks stable.<br />One page needs a performance review.</small></div></div>{["Homepage","Service pages","Contact page"].map((service,row)=><div className="fp2-service-row" key={service}><span>{service}</span><div className="fp2-uptime-track" aria-label={`${service}: ${row===2?"one slow check":"all sample checks healthy"}`}>{Array.from({length:18},(_,index)=><i key={index} className={row===2 && index===12?"warning":""} />)}</div><b>{["0.8 s","1.1 s","2.7 s"][row]}</b></div>)}<div className="fp2-service-foot"><Activity size={13} /> Contact page · slower mobile response</div></>}
              {active===2 && <>{[{name:"Discovery sessions",value:"8,426",width:"100%"},{name:"Service page views",value:"3,184",width:"64%"},{name:"Enquiry starts",value:"217",width:"29%"}].map(step=><div className="fp2-funnel-step" key={step.name}><div><span>{step.name}</span><strong>{step.value}</strong></div><div className="fp2-funnel-bar"><i style={{width:step.width}} /></div></div>)}<div className="fp2-funnel-summary"><span><ArrowDownRight size={14} style={{display:"inline",marginRight:5}} />Session → enquiry start</span><b>2.58%</b></div><div className="fp2-grid-legend">ILLUSTRATIVE FUNNEL · BARS SCHEMATIC</div></>}
            </div>
            <div className="fp2-chart-note"><CheckCircle2 size={14} />{signal.note}</div>
          </motion.div></AnimatePresence>
        </div>
        <div className="fp2-insight-panel"><div className="fp2-insight-icon"><Sparkles size={18} /></div><div><p className="fp2-console-label">AI-supported insight</p><AnimatePresence mode="wait" initial={false}><motion.div key={active} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:reducedMotion?0:.2}}><h3>{signal.insight}</h3><p>{signal.description}</p></motion.div></AnimatePresence></div><div className="fp2-insight-next"><small>SUGGESTED NEXT STEP</small><b>{signal.next}</b></div></div>
      </div>
      <div className="fp2-console-footer"><span><ShieldCheck size={15} />Illustrative data. Human-led decisions.</span><button type="button" className="fp2-demo-toggle" onClick={togglePlayback} aria-pressed={playing} aria-label={playing ? "Pause preview" : "Play preview"}>{playing?<Pause size={12} />:<Play size={12} />}{playing?"Pause preview":"Play preview"}</button></div>
    </div>
  </div>;
}

export default SignalExplorer;
