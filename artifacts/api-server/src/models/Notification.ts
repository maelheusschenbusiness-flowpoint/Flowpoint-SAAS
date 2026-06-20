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

const notificationSchema = new Schema(
  {
    _id:       { type: String },
    type:      { type: String, default: "info" },
    title:     { type: String, required: true },
    message:   { type: String, required: true },
    link:      { type: String, default: null },
    read:      { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() },
  },
  { toJSON },
);
notificationSchema.index({ createdAt: -1 });

export const NotificationModel = models["Notification"] ?? model("Notification", notificationSchema);
