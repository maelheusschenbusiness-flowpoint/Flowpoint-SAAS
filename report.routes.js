const express =
  require("express");

const PDFDocument =
  require("pdfkit");

const authMiddleware =
  require("../middleware/auth");

const Audit =
  require("../models/Audit");

const Activity =
  require("../models/Activity");

const router =
  express.Router();

/* ======================================================
   EXPORT PDF REPORT
====================================================== */

router.get(
  "/pdf/:auditId",
  authMiddleware,
  async (req, res) => {

    try {

      const audit =
        await Audit.findOne({

          _id:
            req.params.auditId,

          userId:
            req.user._id

        });

      if (!audit) {

        return res.status(404).json({

          success: false

        });

      }

      const doc =
        new PDFDocument();

      res.setHeader(
        "Content-Type",
        "application/pdf"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename=flowpoint-report.pdf`
      );

      doc.pipe(res);

      doc.fontSize(28)
      .text(
        "FlowPoint Report"
      );

      doc.moveDown();

      doc.fontSize(18)
      .text(
        `Website: ${audit.website}`
      );

      doc.moveDown();

      doc.fontSize(16)
      .text(
        `Global Score: ${audit.score}`
      );

      doc.text(
        `SEO Score: ${audit.seoScore}`
      );

      doc.text(
        `Performance Score: ${audit.performanceScore}`
      );

      doc.text(
        `Conversion Score: ${audit.conversionScore}`
      );

      doc.text(
        `Local SEO Score: ${audit.localSeoScore}`
      );

      doc.moveDown();

      doc.fontSize(20)
      .text(
        "Quick Wins"
      );

      audit.quickWins.forEach(
        (item) => {

          doc.fontSize(14)
          .text(
            `• ${item}`
          );

        }
      );

      doc.moveDown();

      doc.fontSize(20)
      .text(
        "Critical Issues"
      );

      audit.criticalIssues.forEach(
        (item) => {

          doc.fontSize(14)
          .text(
            `• ${item}`
          );

        }
      );

      doc.moveDown();

      doc.fontSize(20)
      .text(
        "Opportunities"
      );

      audit.opportunities.forEach(
        (item) => {

          doc.fontSize(14)
          .text(
            `• ${item}`
          );

        }
      );

      doc.end();

      await Activity.create({

        userId:
          req.user._id,

        type:
          "report",

        title:
          "PDF exporté",

        description:
          audit.website

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({

        success: false

      });

    }

  }
);

module.exports =
  router;
