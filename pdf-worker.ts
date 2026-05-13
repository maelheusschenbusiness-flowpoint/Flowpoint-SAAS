import { queue } from "../queues/index.js";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";

interface PdfJobData {
  reportId: string;
  reportType: "seo" | "monitor" | "competitor" | "full";
  userId?: string;
  downloadUrl?: string;
}

queue.register<PdfJobData>("pdf:generate", async (job) => {
  const { reportId, reportType } = job.data;
  logger.info({ reportId, reportType }, "Starting PDF generation job");

  // Simulate PDF generation (replace with puppeteer / pdfkit logic)
  await new Promise((r) => setTimeout(r, 1500));

  const downloadUrl = `/api/reports/${reportId}/download`;

  store.broadcast({
    type: "report:ready",
    reportId,
    reportType,
    downloadUrl,
  });

  logger.info({ reportId }, "PDF generation job completed");
});
