const mongoose =
  require("mongoose");

const TeamMessageSchema =
  new mongoose.Schema({

    userId: {

      type:
        mongoose.Schema.Types.ObjectId,

      ref:
        "User"

    },

    author:
      String,

    channel:
      String,

    content:
      String

  }, {

    timestamps: true

  });

module.exports =
  mongoose.model(
    "TeamMessage",
    TeamMessageSchema
  );
