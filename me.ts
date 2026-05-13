import { Router } from "express";
import { store } from "../services/store.js";

const router = Router();

router.get("/me", (_req, res) => {
  res.json(store.me);
});

export default router;
