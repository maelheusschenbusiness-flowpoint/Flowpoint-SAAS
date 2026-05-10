const express =
  require("express");

const {
  GoogleGenerativeAI
} = require(
  "@google/generative-ai"
);

const authMiddleware =
  require("../middleware/auth");

const router =
  express.Router();

const genAI =
  new GoogleGenerativeAI(
    process.env.GEMINI_API_KEY
  );

/* ======================================================
   AI INSIGHTS
====================================================== */

router.post(
  "/insights",
  authMiddleware,
  async (req, res) => {

    try {

      const {
        prompt
      } = req.body;

      const model =
        genAI.getGenerativeModel({

          model:
            "gemini-1.5-flash"

        });

      const result =
        await model.generateContent(
          `
          Tu es FlowPoint AI.

          Analyse ce site et donne :
          - quick wins
          - SEO improvements
          - conversion ideas
          - local SEO ideas
          - monitoring advice

          Website:
          ${req.user.website}

          Prompt:
          ${prompt}
          `
        );

      return res.json({

        success: true,

        text:
          result.response.text()

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
