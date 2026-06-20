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

const monitorSchema = new Schema(
  {
    _id:           { type: String },
    name:          { type: String, required: true },
    url:           { type: String, required: true },
    status:        { type: String, default: "up" },
    uptime:        { type: Number, default: 100 },
    latency:       { type: Number, default: 0 },
    responseTime:  { type: Number, default: 0 },
    lastCheck:     { type: String, default: "à l'instant" },
    lastChecked:   { type: String, default: null },
    alertEmail:    { type: String, default: "" },
    alertPhone:    { type: String, default: "" },
    isCritical:    { type: Boolean, default: false },
    frequency:     { type: String, default: "5min" },
    lastAlertSent: { type: Number, default: null },
  },
  { timestamps: true, toJSON },
);

const monitorCheckSchema = new Schema(
  {
    _id:          { type: String },
    monitorId:    { type: String, required: true, index: true },
    ok:           { type: Boolean, required: true },
    statusCode:   { type: Number, default: 0 },
    responseTime: { type: Number, default: 0 },
    checkedAt:    { type: Number, required: true, index: true },
  },
  { toJSON },
);

export const MonitorModel      = models["Monitor"]      ?? model("Monitor",      monitorSchema);
export const MonitorCheckModel = models["MonitorCheck"] ?? model("MonitorCheck", monitorCheckSchema);
