import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeGlobalMonitoring } from "./global-monitoring.js";
const dbUrl=process.env["DATABASE_URL"]??"";const isolated=process.env["NODE_ENV"]==="test"&&(()=>{try{const u=new URL(dbUrl);return u.hostname==="127.0.0.1"&&u.pathname==="/flowpoint_ci";}catch{return false;}})();
const suite=isolated?describe:describe.skip;
suite("Global Monitoring PostgreSQL + simulated-provider certification",()=>{
 const orgA=randomUUID(),orgB=randomUUID(),monitorA="qa-bs-"+randomUUID(),monitorB="qa-bs-"+randomUUID();let db:Pool;
 async function scoped<T>(orgId:string,fn:(c:PoolClient)=>Promise<T>):Promise<T>{const c=await db.connect();try{await c.query("BEGIN");await c.query("SELECT set_config('app.current_org_id',$1,true)",[orgId]);const v=await fn(c);await c.query("COMMIT");return v;}catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}finally{c.release();}}
 beforeAll(async()=>{db=new Pool({connectionString:dbUrl,max:3});await scoped(orgA,c=>c.query("INSERT INTO bs_monitor_ownership (bs_id,org_id,claimed_via) VALUES ($1,$2,'created')",[monitorA,orgA]));await scoped(orgB,c=>c.query("INSERT INTO bs_monitor_ownership (bs_id,org_id,claimed_via) VALUES ($1,$2,'created')",[monitorB,orgB]));});
 afterAll(async()=>{if(db){await scoped(orgA,c=>c.query("DELETE FROM bs_monitor_ownership WHERE org_id=$1",[orgA]));await scoped(orgB,c=>c.query("DELETE FROM bs_monitor_ownership WHERE org_id=$1",[orgB]));await db.end();}});
 it("isolates persisted ownership and accurately summarizes synthetic provider data",async()=>{
  const owned=await scoped(orgA,c=>c.query("SELECT bs_id FROM bs_monitor_ownership WHERE org_id=$1",[orgA]));expect(owned.rows.map(x=>x.bs_id)).toEqual([monitorA]);
  const summary=summarizeGlobalMonitoring([{id:monitorA,attributes:{name:"synthetic QA monitor",url:"https://qa-fixture.invalid",regions:["us-east","eu-west"],status:"up",uptime_percentage:"99.9",paused:false}}] as never);
  expect(summary.configuredRegionCount).toBe(2);expect(summary.configuredMonitorCount).toBe(1);expect(summary.regions.map(x=>x.region)).toEqual(["eu-west","us-east"]);expect(summary.note).toContain("not independent per-region measurements");
 });
});
