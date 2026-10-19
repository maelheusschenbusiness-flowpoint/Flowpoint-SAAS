import type { BSMonitor } from "./betterstack-service.js";
export interface RegionalMonitorEntry { region:string; monitorId:string; monitorName:string; status:string; uptimePercentage:number|null; }
export function summarizeGlobalMonitoring(monitors:BSMonitor[]) {
 const entries:RegionalMonitorEntry[]=[];
 for(const monitor of monitors){const regions=Array.isArray(monitor.attributes.regions)?monitor.attributes.regions:[];for(const rawRegion of regions){const region=String(rawRegion||"").trim();if(!region)continue;const n=Number(monitor.attributes.uptime_percentage);entries.push({region,monitorId:monitor.id,monitorName:monitor.attributes.name||monitor.attributes.url||monitor.id,status:monitor.attributes.paused?"paused":String(monitor.attributes.status||"unknown"),uptimePercentage:Number.isFinite(n)?n:null});}}
 const byRegion=new Map<string,RegionalMonitorEntry[]>();for(const entry of entries){const rows=byRegion.get(entry.region)||[];rows.push(entry);byRegion.set(entry.region,rows);}
 return {configuredRegionCount:byRegion.size,configuredMonitorCount:new Set(entries.map(e=>e.monitorId)).size,regions:[...byRegion.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([region,rows])=>({region,monitorCount:rows.length,monitors:rows})),note:"Health and uptime are monitor-level aggregates from Better Stack, not independent per-region measurements."};
}
