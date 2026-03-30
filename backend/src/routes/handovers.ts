import { Router } from "express";
import { pool } from "../db/client";

export const handoversRouter = Router();

handoversRouter.get("/pending", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.status, c.github_url,
            e.name AS owner_name,
            (SELECT created_at FROM handovers h WHERE h.case_id = c.id ORDER BY created_at DESC LIMIT 1)
              AS last_handover_at
     FROM cases c
     LEFT JOIN engineers e ON e.id = c.current_owner_id
     WHERE c.status != 'resolved'
     ORDER BY c.updated_at DESC`
  );
  res.json(rows);
});
