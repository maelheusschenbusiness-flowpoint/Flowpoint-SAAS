const express = require("express");

const Stripe = require("stripe");

const authMiddleware =
  require("../middleware/auth");

const User =
  require("../models/User");

const stripe =
  new Stripe(
    process.env.STRIPE_SECRET_KEY,
    {
      apiVersion:
        "2024-06-20"
    }
  );

const router =
  express.Router();

/* ======================================================
   CREATE CHECKOUT
====================================================== */

router.post(
  "/create-checkout",
  authMiddleware,
  async (req, res) => {

    try {

      const {
        priceId
      } = req.body;

      let customerId =
        req.user
          .stripeCustomerId;

      if (!customerId) {

        const customer =
          await stripe.customers.create({

            email:
              req.user.email,

            name:
              req.user.fullName

          });

        customerId =
          customer.id;

        req.user
          .stripeCustomerId =
          customer.id;

        await req.user.save();

      }

      const session =
        await stripe.checkout.sessions.create({

          customer:
            customerId,

          mode:
            "subscription",

          payment_method_types: [
            "card"
          ],

          line_items: [
            {
              price:
                priceId,

              quantity: 1
            }
          ],

          allow_promotion_codes:
            true,

          subscription_data: {

            trial_period_days:
              14

          },

          success_url:
            `${process.env.PUBLIC_BASE_URL}/dashboard.html#billing`,

          cancel_url:
            `${process.env.PUBLIC_BASE_URL}/dashboard.html#billing`,

          metadata: {

            userId:
              req.user._id.toString()

          }

        });

      return res.json({

        success: true,

        url:
          session.url

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({

        success: false

      });

    }

  }
);

/* ======================================================
   BILLING PORTAL
====================================================== */

router.post(
  "/portal",
  authMiddleware,
  async (req, res) => {

    try {

      if (
        !req.user
          .stripeCustomerId
      ) {

        return res.status(400).json({

          success: false,

          message:
            "No Stripe customer"

        });

      }

      const session =
        await stripe.billingPortal.sessions.create({

          customer:
            req.user
              .stripeCustomerId,

          return_url:
            `${process.env.PUBLIC_BASE_URL}/dashboard.html#billing`

        });

      return res.json({

        success: true,

        url:
          session.url

      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({

        success: false

      });

    }

  }
);

/* ======================================================
   WEBHOOK
====================================================== */

router.post(
  "/webhook",
  express.raw({
    type:
      "application/json"
  }),
  async (req, res) => {

    let event;

    try {

      event =
        stripe.webhooks.constructEvent(
          req.body,
          req.headers[
            "stripe-signature"
          ],
          process.env
            .STRIPE_WEBHOOK_SECRET
        );

    } catch (err) {

      console.error(err);

      return res.sendStatus(400);

    }

    try {

      switch (
        event.type
      ) {

        case
        "checkout.session.completed":

          {
            const session =
              event.data.object;

            const user =
              await User.findById(
                session.metadata
                  .userId
              );

            if (user) {

              user.subscriptionStatus =
                "active";

              user.accessBlocked =
                false;

              await user.save();

            }
          }

          break;

        case
        "invoice.payment_failed":

          {
            const invoice =
              event.data.object;

            const user =
              await User.findOne({

                stripeCustomerId:
                  invoice.customer

              });

            if (user) {

              user.accessBlocked =
                true;

              await user.save();

            }

          }

          break;

        case
        "invoice.payment_succeeded":

          {
            const invoice =
              event.data.object;

            const user =
              await User.findOne({

                stripeCustomerId:
                  invoice.customer

              });

            if (user) {

              user.accessBlocked =
                false;

              user.subscriptionStatus =
                "active";

              await user.save();

            }

          }

          break;

      }

      return res.json({
        received: true
      });

    } catch (err) {

      console.error(err);

      return res.sendStatus(500);

    }

  }
);

module.exports = router;
