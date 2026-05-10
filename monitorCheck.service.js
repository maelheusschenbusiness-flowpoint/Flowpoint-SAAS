const https =
  require("https");

const http =
  require("http");

module.exports =
  async function(
    monitor
  ) {

    return new Promise(
      (resolve) => {

        try {

          const startedAt =
            Date.now();

          const protocol =
            monitor.url.startsWith(
              "https"
            )
              ? https
              : http;

          const req =
            protocol.get(
              monitor.url,
              (response) => {

                const responseTime =
                  Date.now() -
                  startedAt;

                monitor.status =
                  response.statusCode >=
                  400
                    ? "offline"
                    : "online";

                monitor.responseTime =
                  responseTime;

                monitor.history.push({

                  status:
                    monitor.status,

                  responseTime,

                  checkedAt:
                    new Date()

                });

                monitor.history =
                  monitor.history.slice(
                    -100
                  );

                monitor.save();

                resolve();

              }
            );

          req.on(
            "error",
            async () => {

              monitor.status =
                "offline";

              monitor.incidents +=
                1;

              monitor.history.push({

                status:
                  "offline",

                responseTime:
                  0,

                checkedAt:
                  new Date()

              });

              await monitor.save();

              resolve();

            }
          );

          req.setTimeout(
            12000
          );

        } catch (err) {

          console.error(err);

          resolve();

        }

      }
    );

  };
