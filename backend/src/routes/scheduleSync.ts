import { Router, Request, Response } from "express";
import { syncSchedule } from "../services/scheduleProvider";

const router = Router();

// ── POST /api/schedule/sync ───────────────────────────────────────────────────
router.post("/sync", async (_req: Request, res: Response) => {
  try {
    const result = await syncSchedule();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;