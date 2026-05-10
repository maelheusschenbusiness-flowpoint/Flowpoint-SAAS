const mongoose =
  require("mongoose");

const ReportSchema =
  new mongoose.Schema({

    userId: {

      type:
        mongoose.Schema.Types.ObjectId,

      ref:
        "User"

    },

    title:
      String,

    type:
      String,

    generatedAt:
      Date,

    downloadUrl:
      String

  }, {

    timestamps: true

  });

module.exports =
  mongoose.model(
    "Report",
    ReportSchema
  );
