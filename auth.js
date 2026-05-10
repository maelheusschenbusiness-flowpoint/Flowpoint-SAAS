const jwt = require("jsonwebtoken");

const User = require("../models/User");

module.exports = async function(
  req,
  res,
  next
) {

  try {

    const authHeader =
      req.headers.authorization;

    if (!authHeader) {

      return res.status(401).json({

        success: false,

        message:
          "Unauthorized"

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

        success: false,

        message:
          "User not found"

      });

    }

    if (user.accessBlocked) {

      return res.status(403).json({

        success: false,

        message:
          "Subscription inactive"

      });

    }

    req.user = user;

    next();

  } catch (err) {

    return res.status(401).json({

      success: false,

      message:
        "Invalid token"

    });

  }

};
