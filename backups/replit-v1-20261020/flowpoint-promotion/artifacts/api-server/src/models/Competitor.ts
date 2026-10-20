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

const competitorSchema = new Schema(
  {
    _id:          { type: String },
    name:         { type: String, required: true },
    url:          { type: String, required: true },
    domainRating: { type: Number, default: 0 },
    keywords:     { type: Number, default: 0 },
    traffic:      { type: Number, default: 0 },
    threatLevel:  { type: String, default: "low" },
    delta:        { type: Number, default: 0 },
  },
  { timestamps: true, toJSON },
);
competitorSchema.index({ domainRating: -1 });

export const CompetitorModel = models["Competitor"] ?? model("Competitor", competitorSchema);
