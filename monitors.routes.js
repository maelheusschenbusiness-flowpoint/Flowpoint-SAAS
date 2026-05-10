const express = require("express");

const authMiddleware =
  require("../middleware/auth");

const User =
  require("../models/User");

const Monitor =
  require("../models/Monitor");

const Audit =
  require("../models/Audit");

const Mission =
  require("../models/Mission");

const Activity =
  require("../models/Activity");

const router =
  express.Router();

/* ======================================================
   OVERVIEW
====================================================== */

router.get(
  "/overview",
  authMiddleware,
  async (req, res) => {

    try {

      const user =
        req.user;

      const monitors =
        await Monitor.find({
          userId:
            user._id
        });

      const audits =
        await Audit.find({
          userId:
            user._id
        })
        .sort({
          createdAt: -1
        })
        .limit(20);

      const missions =
        await Mission.find({
          userId:
            user._id
        });

      const activity =
        await Activity.find({
          userId:
            user._id
        })
        .sort({
          createdAt: -1
        })
        .limit(30);

      const completedMissions =
        missions.filter(
          (mission) =>
            mission.completed
        ).length;

      const averageAudit =
        audits.length
          ? Math.round(
              audits.reduce(
                (acc, item) =>
                  acc +
                  (item.score || 0),
                0
              ) / audits.length
            )
          : 0;

      const onlineMonitors =
        monitors.filter(
          (monitor) =>
            monitor.status ===
            "online"
        ).length;

      const offlineMonitors =
        monitors.filter(
          (monitor) =>
            monitor.status ===
            "offline"
        ).length;

      return res.json({

        success: true,

        stats: {

          monitors:
            monitors.length,

          onlineMonitors,

          offlineMonitors,

          audits:
            audits.length,

          missions:
            missions.length,

          completedMissions,

          auditScore:
            averageAudit,

          uptime:
            monitors.length
              ? Math.round(
                  monitors.reduce(
                    (acc, monitor) =>
                      acc +
                      (monitor.uptime ||
                        0),
                    0
                  ) /
                    monitors.length
                )
              : 100

        },

        monitors,

        audits,

        missions,

        activity,

        user

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({

        success: false

      });

    }

  }
);

module.exports = router;
