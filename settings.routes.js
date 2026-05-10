const express =
  require("express");

const authMiddleware =
  require("../middleware/auth");

const User =
  require("../models/User");

const router =
  express.Router();

/* ======================================================
   GET SETTINGS
====================================================== */

router.get("/",
authMiddleware,
async (req, res) => {

  try {

    return res.json({

      success: true,

      settings: {

        fullName:
          req.user.fullName,

        companyName:
          req.user.companyName,

        website:
          req.user.website,

        email:
          req.user.email,

        plan:
          req.user.plan,

        addons:
          req.user.addons

      }

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false

    });

  }

});

/* ======================================================
   UPDATE SETTINGS
====================================================== */

router.patch("/",
authMiddleware,
async (req, res) => {

  try {

    const {
      fullName,
      companyName,
      website
    } = req.body;

    req.user.fullName =
      fullName;

    req.user.companyName =
      companyName;

    req.user.website =
      website;

    await req.user.save();

    return res.json({

      success: true,

      user:
        req.user

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
