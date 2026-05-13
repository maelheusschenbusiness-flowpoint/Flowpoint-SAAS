import { fileURLToPath } from "node:url";
import path from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());

app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  (req: Request & { rawBody?: Buffer }, _res: Response, next: NextFunction) => {
    req.rawBody = req.body as Buffer;
    next();
  },
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the FlowPoint dashboard static files (HTML/CSS/JS) directly.
// In dev __dirname = src/, in prod __dirname = dist/ — both reach flowpoint-export via ../../.
const dashboardDir = path.resolve(__dirname, "../../flowpoint-export");
app.use("/api/dashboard", express.static(dashboardDir));

app.use("/api", router);

export default app;
