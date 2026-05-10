const mongoose =
  require("mongoose");

const MissionSchema =
  new mongoose.Schema({

    userId: {

      type:
        mongoose.Schema.Types.ObjectId,

      ref:
        "User"

    },

    title:
      String,

    description:
      String,

    category:
      String,

    priority:
      String,

    completed: {

      type:
        Boolean,

      default:
        false

    },

    estimatedImpact:
      String,

    estimatedDifficulty:
      String,

    source: {

      type:
        String,

      default:
        "ai"

    }

  }, {

    timestamps: true

  });

module.exports =
  mongoose.model(
    "Mission",
    MissionSchema
  );
