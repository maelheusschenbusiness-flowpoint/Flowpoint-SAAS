/**
 * Sert la VRAIE route admin Croissance sur localhost, avec le VRAI `@workspace/db`.
 *
 * Uniquement pour le test de bout en bout de la synchronisation : il se lance a la
 * main, contre une base JETABLE, jamais en production. Rien ici n'est importe par
 * l'application.
 *
 *   DATABASE_URL=<base jetable> GROWTH_ADMIN_KEY=<48 caracteres> PORT=5610 \
 *     ./node_modules/.bin/tsx e2e-growth-server.ts
 *
 * La procedure complete est dans `deploy/growth-e2e/README.md` du depot AI Lab.
 */
import express from "express";
import adminRouter from "./src/routes/admin.ts";

const app = express();
app.use(express.json());
app.use("/api", adminRouter);
app.listen(Number(process.env.PORT ?? 5610), "127.0.0.1",
  () => console.log("e2e growth server on " + (process.env.PORT ?? 5610)));
