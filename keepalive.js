const https = require("https");

const URL = process.env.PUBLIC_BASE_URL;

function ping() {
  if (!URL) return;

  https.get(`${URL}/api/health`, (res) => {
    console.log("Keepalive ping:", res.statusCode);
  }).on("error", (err) => {
    console.log("Keepalive error:", err.message);
  });
}

// Ping toutes les 5 minutes
setInterval(ping, 5 * 60 * 1000);
