const express =
  require("express");

const authMiddleware =
  require("../middleware/auth");

const router =
  express.Router();

/* ======================================================
   TEAM PLACEHOLDER
====================================================== */

router.get("/",
authMiddleware,
async (req, res) => {

  try {

    return res.json({

      success: true,

      members: [

        {
          name:
            req.user.fullName,

          role:
            "Owner",

          status:
            "online"
        }

      ],

      channels: [

        {
          name:
            "general"
        },

        {
          name:
            "seo"
        },

        {
          name:
            "monitoring"
        }

      ]

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false

    });

  }

});

module.exports =
  router;
