const mongoose =
  require("mongoose");

const AuditSchema =
  new mongoose.Schema({

    userId: {

      type:
        mongoose.Schema.Types.ObjectId,

      ref:
        "User"

    },

    website:
      String,

    score:
      Number,

    seoScore:
      Number,

    performanceScore:
      Number,

    conversionScore:
      Number,

    localSeoScore:
      Number,

    quickWins:
      [String],

    criticalIssues:
      [String],

    opportunities:
      [String],

    pages: [

      {
        url:
          String,

        score:
          Number
      }

    ]

  }, {

    timestamps: true

  });

module.exports =
  mongoose.model(
    "Audit",
    AuditSchema
  );
