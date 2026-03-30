import { Router } from "express";
import { pool } from "../db/client";

export const dutyRouter = Router();

dutyRouter.get("/current", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, e.name, e.github_handle FROM duty_weeks d
     JOIN engineers e ON e.id = d.engineer_id
     WHERE week_start <= CURRENT_DATE AND week_end >= CURRENT_DATE
     LIMIT 1`
  );
  res.json(rows[0] ?? null);
});

dutyRouter.get("/", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, e.name, e.github_handle FROM duty_weeks d
     JOIN engineers e ON e.id = d.engineer_id
     ORDER BY week_start DESC`
  );
  res.json(rows);
});

dutyRouter.post("/", async (req, res) => {
  const { engineer_id, week_start, week_end, notes } = req.body;
  if (!engineer_id || !week_start || !week_end)
    return res.status(400).json({ error: "engineer_id, week_start, week_end required" });
  try {
    const { rows } = await pool.query(
      "INSERT INTO duty_weeks (engineer_id, week_start, week_end, notes) VALUES ($1,$2,$3,$4) RETURNING *",
      [engineer_id, week_start, week_end, notes ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
