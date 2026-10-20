import { mongoose } from "../lib/mongo.js";

const { Schema, model, models } = mongoose;

const toJSON = {
  transform: (_: unknown, ret: Record<string, unknown>) => {
    ret["id"] = ret["_id"];
    delete ret["_id"];
    delete ret["__v"];
    return ret;
  },
};

const auditSchema = new Schema(
  {
    _id:    { type: String },
    url:    { type: String, required: true },
    score:  { type: Number, default: 0 },
    status: { type: String, default: "processing" },
    speed:  { type: Number, default: 0 },
    date:   { type: String, required: true },
    issues: { type: Number, default: 0 },
    origin: { type: String, default: "manual" },
  },
  { toJSON },
);
auditSchema.index({ date: -1 });
auditSchema.index({ url: 1, date: 1 });

const auditScheduleSchema = new Schema(
  {
    _id:       { type: String },
    url:       { type: String, required: true, unique: true },
    frequency: { type: String, default: "weekly" },
    nextRun:   { type: Number, required: true },
    createdAt: { type: Number, default: () => Date.now() },
  },
  { toJSON },
);

export const AuditModel         = models["Audit"]         ?? model("Audit",         auditSchema);
export const AuditScheduleModel = models["AuditSchedule"] ?? model("AuditSchedule", auditScheduleSchema);
