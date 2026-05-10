const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Activity = require("../models/Activity");

const router = express.Router();

/* ======================================================
   REGISTER
====================================================== */

router.post("/register",
async (req, res) => {

  try {

    const {
      email,
      password,
      fullName,
      companyName,
      website
    } = req.body;

    if (
      !email ||
      !password
    ) {

      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });

    }

    const existingUser =
      await User.findOne({
        email
      });

    if (existingUser) {

      return res.status(400).json({
        success: false,
        message:
          "Email already used"
      });

    }

    const hashedPassword =
      await bcrypt.hash(
        password,
        10
      );

    const user =
      await User.create({

        email,

        password:
          hashedPassword,

        fullName,

        companyName,

        website,

        trialEndsAt:
          new Date(
            Date.now() +
            14 *
            24 *
            60 *
            60 *
            1000
          )

      });

    await Activity.create({

      userId: user._id,

      type: "account",

      title:
        "Compte créé",

      description:
        "Nouvel utilisateur FlowPoint"

    });

    const token = jwt.sign(
      {
        userId:
          user._id
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );

    return res.json({

      success: true,

      token,

      user

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false,

      message:
        "Register error"

    });

  }

});

/* ======================================================
   LOGIN
====================================================== */

router.post("/login",
async (req, res) => {

  try {

    const {
      email,
      password
    } = req.body;

    const user =
      await User.findOne({
        email
      });

    if (!user) {

      return res.status(400).json({
        success: false,
        message:
          "Invalid credentials"
      });

    }

    const validPassword =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!validPassword) {

      return res.status(400).json({
        success: false,
        message:
          "Invalid credentials"
      });

    }

    const token = jwt.sign(
      {
        userId:
          user._id
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );

    return res.json({

      success: true,

      token,

      user

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({

      success: false,

      message:
        "Login error"

    });

  }

});

/* ======================================================
   VERIFY TOKEN
====================================================== */

router.get("/me",
async (req, res) => {

  try {

    const authHeader =
      req.headers.authorization;

    if (!authHeader) {

      return res.status(401).json({
        success: false
      });

    }

    const token =
      authHeader.split(" ")[1];

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    const user =
      await User.findById(
        decoded.userId
      );

    if (!user) {

      return res.status(401).json({
        success: false
      });

    }

    return res.json({

      success: true,

      user

    });

  } catch (err) {

    return res.status(401).json({

      success: false

    });

  }

});

module.exports = router;
