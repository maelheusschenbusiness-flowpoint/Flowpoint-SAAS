const mongoose =
  require("mongoose");

const ActivitySchema =
  new mongoose.Schema({

    userId: {

      type:
        mongoose.Schema.Types.ObjectId,

      ref:
        "User"

    },

    type: String,

    title: String,

    description: String

  }, {

    timestamps: true

  });

module.exports =
  mongoose.model(
    "Activity",
    ActivitySchema
  );
