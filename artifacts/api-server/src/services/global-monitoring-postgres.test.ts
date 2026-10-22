import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { summarizeGlobalMonitoring } from "./global-monitoring.js";
const orgA=randomUUID(), orgB=randomUUID(), monitorA="qa-bs-monitor-a-"+randomUUID(), monitorB="qa-bs-monitor-b-"+randomUUID();
async function scoped(orgId:string,sql:string,values:unknown[]=[]){const c=await pool.connect();try{await c.query("BEGIN");await c.query("SELECT set_config('app.current_org_id',$1,true)",[orgId]);const r=await c.query(sql,values);await c.query("COMMIT");return r;}catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}finally{c.release();}}
describe("Global Monitoring PostgreSQL + simulated-provider certification",()=>{
 beforeAll(async()=>{await scoped(orgA,"INSERT INTO bs_monitor_ownership (bs_id,org_id,claimed_via) VALUES ($1,$2,'created')",[monitorA,orgA]);await scoped(orgB,"INSERT INTO bs_monitor_ownership (bs_id,org_id,claimed_via) VALUES ($1,$2,'created')",[monitorB,orgB]);});
 afterAll(async()=>{await scoped(orgA,"DELETE FROM bs_monitor_ownership WHERE org_id=$1",[orgA]);await scoped(orgB,"DELETE FROM bs_monitor_ownership WHERE org_id=$1",[orgB]);});
 it("isolates persisted monitor ownership and accurately labels simulated regions",async()=>{
  const owned=await scoped(orgA,"SELECT bs_id FROM bs_monitor_ownership WHERE org_id=$1",[orgA]);
  expect(owned.rows.map(x=>x.bs_id)).toEqual([monitorA]);
  const summary=summarizeGlobalMonitoring([{id:monitorA,attributes:{name:"synthetic QA monitor",url:"https://qa-fixture.invalid",regions:["us-east","eu-west"],status:"up",uptime_percentage:"99.9",paused:false}}] as never);
  expect(summary.configuredRegionCount).toBe(2);expect(summary.configuredMonitorCount).toBe(1);
  expect(summary.regions.map(x=>x.region)).toEqual(["eu-west","us-east"]);
  expect(summary.note).toContain("not independent per-region measurements");
 });
});
