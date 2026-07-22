import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDb } from "./db/client";
import casesRouter from "./routes/cases";
import { engineersRouter } from "./routes/engineers";
import { dutyRouter } from "./routes/duty";
import { handoversRouter } from "./routes/handovers";
import chatRouter from "./routes/chat";
import reportsRouter from "./routes/reports";
import scheduleSyncRouter from "./routes/scheduleSync";
import scanRouter from "./routes/scan";
import slackImportRouter from "./routes/slackImport";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_, res) => res.json({ status: "ok" }));

// Routes
app.use("/api/cases", casesRouter);
app.use("/api/cases", chatRouter);
app.use("/api/engineers", engineersRouter);
app.use("/api/duty", dutyRouter);
app.use("/api/handovers", handoversRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/schedule", scheduleSyncRouter);
app.use("/api/scan", scanRouter);
app.use("/api/cases", slackImportRouter);

initDb().then(() => {
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`SDH backend running on :${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to initialise DB:", err);
  process.exit(1);
});