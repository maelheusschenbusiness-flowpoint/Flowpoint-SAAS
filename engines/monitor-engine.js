'use strict';

const https = require('https');
const http = require('http');

function requestUrl(url, timeout = 8000) {

  return new Promise((resolve) => {

    try {

      const startedAt = Date.now();

      const lib =
        url.startsWith('https')
          ? https
          : http;

      const req = lib.request(
        url,
        {
          method: 'GET',
          timeout,
        },

        (res) => {

          const latency =
            Date.now() - startedAt;

          resolve({

            success:
              res.statusCode >= 200 &&
              res.statusCode < 500,

            statusCode:
              res.statusCode,

            latency,

          });
        }
      );

      req.on(
        'timeout',
        () => {

          req.destroy();

          resolve({

            success: false,

            statusCode: 408,

            latency: timeout,

          });
        }
      );

      req.on(
        'error',
        () => {

          resolve({

            success: false,

            statusCode: 500,

            latency: timeout,

          });
        }
      );

      req.end();

    } catch {

      resolve({

        success: false,

        statusCode: 500,

        latency: timeout,

      });
    }
  });
}

async function runMonitorCheck(
  monitor
) {

  const result =
    await requestUrl(
      monitor.url
    );

  const previous =
    monitor.lastStatus;

  monitor.lastCheckedAt =
    new Date();

  monitor.lastStatusCode =
    result.statusCode;

  monitor.lastResponseTime =
    result.latency;

  monitor.lastStatus =
    result.success
      ? 'up'
      : 'down';

  if (
    previous === 'up' &&
    !result.success
  ) {

    monitor.incidents.push({

      startedAt:
        new Date(),

      reason:
        `HTTP ${result.statusCode}`,
    });
  }

  if (
    previous === 'down' &&
    result.success
  ) {

    const active =
      monitor.incidents.find(
        x => !x.endedAt
      );

    if (active) {

      active.endedAt =
        new Date();
    }
  }

  await monitor.save();

  return monitor;
}

module.exports = {
  runMonitorCheck,
};
