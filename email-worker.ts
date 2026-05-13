import { queue } from "../queues/index.js";
import { logger } from "../lib/logger.js";
import { sendEmail } from "../services/email.js";

interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  tags?: Record<string, string>;
}

queue.register<EmailJobData>("email:send", async (job) => {
  const { to, subject, html, from, replyTo } = job.data;
  logger.info({ to, subject }, "Processing email job");

  await sendEmail({ to, subject, html, from, replyTo });

  logger.info({ to, subject }, "Email job completed");
});

// Helper: enqueue an email
export function enqueueEmail(data: EmailJobData) {
  return queue.add("email:send", data, { maxAttempts: 5 });
}
