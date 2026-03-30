import { Router } from "express";
import { pool } from "../db/client";

export const engineersRouter = Router();

engineersRouter.get("/", async (_, res) => {
  const { rows } = await pool.query("SELECT * FROM engineers ORDER BY name");
  res.json(rows);
});

engineersRouter.post("/", async (req, res) => {
  const { name, github_handle, email } = req.body;
  if (!name || !github_handle)
    return res.status(400).json({ error: "name and github_handle required" });
  try {
    const { rows } = await pool.query(
      "INSERT INTO engineers (name, github_handle, email) VALUES ($1,$2,$3) RETURNING *",
      [name, github_handle, email ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
