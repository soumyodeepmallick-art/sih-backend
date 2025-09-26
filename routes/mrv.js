import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ✅ Create MRV record
router.post("/", async (req, res) => {
  try {
    const { projectId, date, type, source, ndvi, evi, carbonStock, changeDetection, status } = req.body;

    const { data, error } = await supabase
      .from("mrv_data")
      .insert([
        {
          project_id: projectId,
          date,
          type,
          source,
          ndvi,
          evi,
          carbon_stock: carbonStock,
          change_detection: changeDetection,
          status: status || "pending",
        },
      ])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, mrv: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to save MRV data", details: err.message });
  }
});

// ✅ Get MRV records by projectId
router.get("/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { data, error } = await supabase
      .from("mrv_data")
      .select("*")
      .eq("project_id", projectId)
      .order("date", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch MRV data", details: err.message });
  }
});

export default router;
