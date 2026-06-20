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

const userProfileSchema = new Schema(
  {
    _id:         { type: String },
    email:       { type: String, required: true },
    firstName:   { type: String, default: "" },
    lastName:    { type: String, default: "" },
    companyName: { type: String, default: "" },
    website:     { type: String, default: "" },
    country:     { type: String, default: "" },
    companySize: { type: String, default: "" },
    objective:   { type: String, default: "" },
    plan:        { type: String, default: "standard" },
    trialEndsAt: { type: String, default: null },
    orgId:       { type: String, default: "default" },
  },
  { timestamps: true, toJSON },
);

export const UserProfileModel = models["UserProfile"] ?? model("UserProfile", userProfileSchema);
