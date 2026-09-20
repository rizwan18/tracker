import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import transactionRoutes from "./routes/transactions";
import categoryRoutes from "./routes/categories";
import accountRoutes from "./routes/accounts";
import propertyRoutes from "./routes/properties";
import investmentRoutes from "./routes/investments";
import dividendRoutes from "./routes/dividends";
import capitalGainsRoutes from "./routes/capitalGains";
import billRoutes from "./routes/bills";
import reminderRoutes from "./routes/reminders";
import dashboardRoutes from "./routes/dashboard";
import reportRoutes from "./routes/reports";
import searchRoutes from "./routes/search";
import documentRoutes from "./routes/documents";
import dataRoutes from "./routes/data";
import portfolioRoutes from "./routes/portfolios";
import businessRoutes from "./routes/business";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  // The frontend and API are normally served from the same origin (one Vercel
  // project, or the Express server serving frontend/dist), so CORS isn't
  // needed in the default setup. It stays enabled for the case where the
  // frontend is hosted on a different domain: bearer-token auth (not cookies)
  // means a wildcard origin carries no CSRF risk, but CORS_ORIGIN lets you
  // lock it down to your actual frontend domain if you'd prefer.
  app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/transactions", transactionRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/accounts", accountRoutes);
  app.use("/api/properties", propertyRoutes);
  app.use("/api/investments", investmentRoutes);
  app.use("/api/dividends", dividendRoutes);
  app.use("/api/capital-gains", capitalGainsRoutes);
  app.use("/api/bills", billRoutes);
  app.use("/api/reminders", reminderRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/documents", documentRoutes);
  app.use("/api/data", dataRoutes);
  app.use("/api/portfolios", portfolioRoutes);
  app.use("/api/business", businessRoutes);

  // 404 for unknown API routes, before the generic error handler.
  app.use("/api", (_req, res) => res.status(404).json({ error: "We couldn't find what you were looking for." }));

  app.use(errorHandler);

  return app;
}
