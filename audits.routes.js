const express =
  require("express");

const authMiddleware =
  require("../middleware/auth");

const Audit =
  require("../models/Audit");

const Activity =
  require("../models/Activity");

const router =
  express.Router();

/* ======================================================
   GET AUDITS
====================================================== */

router.get("/",
authMiddleware,
async (req, res) => {

  try {

    const audits =
      await Audit.find({

        userId:
          req.user._id

      })
      .sort({
        createdAt: -1
      });

    return res.json({

      success: true,

      audits

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false

    });

  }

});

/* ======================================================
   CREATE DEMO AUDIT
====================================================== */

router.post("/generate",
authMiddleware,
async (req, res) => {

  try {

    const audit =
      await Audit.create({

        userId:
          req.user._id,

        website:
          req.user.website,

        score:
          Math.floor(
            Math.random() * 25
          ) + 70,

        seoScore:
          Math.floor(
            Math.random() * 20
          ) + 75,

        performanceScore:
          Math.floor(
            Math.random() * 20
          ) + 70,

        conversionScore:
          Math.floor(
            Math.random() * 20
          ) + 65,

        localSeoScore:
          Math.floor(
            Math.random() * 20
          ) + 70,

        quickWins: [

          "Optimiser les balises title",

          "Compresser les images",

          "Ajouter des CTA visibles"

        ],

        criticalIssues: [

          "Temps de chargement élevé"

        ],

        opportunities: [

          "Créer des pages locales"

        ]

      });

    await Activity.create({

      userId:
        req.user._id,

      type:
        "audit",

      title:
        "Audit généré",

      description:
        req.user.website

    });

    return res.json({

      success: true,

      audit

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false

    });

  }

});

module.exports = router;
