import { describe, expect, it } from "vitest";
import { AGENCY_REPORT_PACKS } from "./agency-reporting-packs.js";
describe("agency reporting packs",()=>{it("offers unique report templates supported by the existing report flow",()=>{expect(new Set(AGENCY_REPORT_PACKS.map(p=>p.id)).size).toBe(AGENCY_REPORT_PACKS.length);expect(AGENCY_REPORT_PACKS.map(p=>p.templateKey)).toEqual(["executive","seo","local"]);});});
