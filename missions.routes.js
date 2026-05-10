const express = require("express");

const authMiddleware =
  require("../middleware/auth");

const Mission =
  require("../models/Mission");

const router =
  express.Router();

/* ======================================================
   GET MISSIONS
====================================================== */

router.get("/",
authMiddleware,
async (req, res) => {

  try {

    const missions =
      await Mission.find({

        userId:
          req.user._id

      });

    return res.json({

      success: true,

      missions

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false

    });

  }

});

/* ======================================================
   GENERATE MISSIONS
====================================================== */

router.post("/generate",
authMiddleware,
async (req, res) => {

  try {

    const templates = [

      {
        title:
          "Optimiser les balises title",

        category:
          "seo",

        priority:
          "high",

        description:
          "Améliorer les titres SEO des pages critiques."
      },

      {
        title:
          "Réduire le temps de chargement",

        category:
          "performance",

        priority:
          "high",

        description:
          "Optimiser les assets et scripts."
      },

      {
        title:
          "Créer des pages locales",

        category:
          "local-seo",

        priority:
          "medium",

        description:
          "Développer les pages géolocalisées."
      },

      {
        title:
          "Ajouter des CTA visibles",

        category:
          "conversion",

        priority:
          "medium",

        description:
          "Améliorer les conversions du site."
      }

    ];

    const created = [];

    for (const template of templates) {

      const mission =
        await Mission.create({

          userId:
            req.user._id,

          ...template,

          estimatedImpact:
            "High",

          estimatedDifficulty:
            "Medium"

        });

      created.push(
        mission
      );

    }

    return res.json({

      success: true,

      missions:
        created

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false

    });

  }

});

/* ======================================================
   TOGGLE MISSION
====================================================== */

router.patch("/:id/toggle",
authMiddleware,
async (req, res) => {

  try {

    const mission =
      await Mission.findOne({

        _id:
          req.params.id,

        userId:
          req.user._id

      });

    if (!mission) {

      return res.status(404).json({

        success: false

      });

    }

    mission.completed =
      !mission.completed;

    await mission.save();

    return res.json({

      success: true,

      mission

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false

    });

  }

});

module.exports = router;
