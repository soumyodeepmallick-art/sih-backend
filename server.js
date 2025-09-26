// ------------------- Backend API -------------------
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 4000;

// ------------------- Supabase -------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ------------------- Middleware -------------------
app.use(
  cors({
    origin: "*", // tighten later
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// ------------------- File Upload Config -------------------
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ==========================================================
// SUBMISSIONS
// ==========================================================

/* ---------- POST /api/submissions ---------- */
app.post("/api/submissions", upload.single("file"), async (req, res) => {
  try {
    const { body, file } = req;
    if (!body?.description) {
      return res.status(400).json({ error: "Missing description" });
    }
    if (!file) {
      return res.status(400).json({ error: "Missing file (field name 'file')" });
    }

    // Upload file to Pinata
    const form = new FormData();
    form.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
      knownLength: file.size,
    });

    form.append(
      "pinataMetadata",
      JSON.stringify({
        name: file.originalname,
        keyvalues: { uploader: body.name || "anonymous", description: body.description || "" },
      })
    );
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const pinataResp = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.PINATA_JWT}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const ipfsHash = pinataResp.data?.IpfsHash;
    const ipfsUrl = ipfsHash ? `https://gateway.pinata.cloud/ipfs/${ipfsHash}` : null;

    const submission = {
      id: uuidv4(),
      applicantAddress: body.applicantAddress || null,
      title: body.name || null,
      description: body.description,
      latitude: body.latitude || null,
      longitude: body.longitude || null,
      ipfsHash,
      imageUrl: ipfsUrl,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    const { error } = await supabase.from("submissions").insert([submission]);
    if (error) throw error;

    res.status(201).json({ success: true, submission });
  } catch (err) {
    console.error("❌ Error /api/submissions:", err.message);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

/* ---------- GET /api/submissions ---------- */
app.get("/api/submissions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("submissions")
      .select("*")
      .order("createdAt", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

/* ---------- GET /api/submissions/:id/metadata ---------- */
app.get("/api/submissions/:id/metadata", async (req, res) => {
  try {
    const { data, error } = await supabase.from("submissions").select("*").eq("id", req.params.id).single();
    if (error) return res.status(404).json({ error: "Not found" });

    const metadata = {
      name: data.title || "Untitled Submission",
      description: data.description || "",
      image: data.imageUrl,
      metadataURI: data.imageUrl,
      attributes: [
        { trait_type: "Applicant Address", value: data.applicantAddress },
        { trait_type: "Latitude", value: data.latitude },
        { trait_type: "Longitude", value: data.longitude },
      ],
    };
    res.json(metadata);
  } catch (err) {
    res.status(500).json({ error: "Error fetching metadata" });
  }
});

/* ---------- POST /api/submissions/:id/minted ---------- */
app.post("/api/submissions/:id/minted", async (req, res) => {
  try {
    const { txHash, tokenId, metadataURI } = req.body;
    const { data, error } = await supabase
      .from("submissions")
      .update({ status: "approved", txHash, tokenId, metadataURI })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, submission: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark minted" });
  }
});

// ==========================================================
// PROJECTS
// ==========================================================

/* ---------- POST /api/projects ---------- */
app.post("/api/projects", async (req, res) => {
  try {
    const {
      projectId,
      projectName,
      latitude,
      longitude,
      ecosystemType,
      ownership,
      governance,
      implementingAgency,
      projectDescription,
      area,
      establishmentDate,
    } = req.body;

    if (!projectId || !projectName || !latitude || !longitude || !ecosystemType || !implementingAgency) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from("projects")
      .insert([
        {
          projectId,
          projectName,
          latitude,
          longitude,
          ecosystemType,
          ownership,
          governance,
          implementingAgency,
          projectDescription,
          area,
          establishmentDate,
          status: "draft",
          createdAt: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, project: data });
  } catch (err) {
    console.error("❌ Error /api/projects:", err.message);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

/* ---------- GET /api/projects ---------- */
app.get("/api/projects", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("createdAt", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

/* ---------- PUT /api/projects/:id/submit ---------- */
app.put("/api/projects/:id/submit", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("projects")
      .update({ status: "submitted" })
      .eq("projectId", req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, project: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to submit project" });
  }
});

// ==========================================================
// BASELINE DATA
// ==========================================================

/* ---------- POST /api/baseline ---------- */
app.post("/api/baseline", async (req, res) => {
  try {
    const {
      projectId,
      vegetationCover,
      ndvi,
      soilOrganicCarbon,
      bulkDensity,
      soilDepth,
      historicalLandUse,
      samplingDate,
      samplingMethod,
      laboratoryCertification,
      carbonStock,
    } = req.body;

    if (!projectId || !samplingDate) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from("baseline_data")
      .insert([
        {
          projectId,
          vegetationCover,
          ndvi,
          soilOrganicCarbon,
          bulkDensity,
          soilDepth,
          historicalLandUse,
          samplingDate,
          samplingMethod,
          laboratoryCertification,
          carbonStock,
          createdAt: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, baseline: data });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

/* ---------- GET /api/baseline/:projectId ---------- */
app.get("/api/baseline/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { data, error } = await supabase.from("baseline_data").select("*").eq("projectId", projectId);
    if (error) throw error;
    res.json({ success: true, baseline: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// ACTIVITIES
// ==========================================================

/* ---------- POST /api/activities ---------- */
app.post("/api/activities", async (req, res) => {
  try {
    const { projectId, type, date, species, saplings, area, maintenance, crew, coordinates, photos, status } = req.body;

    if (!projectId || !type || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from("activities")
      .insert([
        {
          projectId,
          type,
          date,
          species,
          saplings,
          area,
          maintenance,
          crew,
          coordinates,
          photos,
          status: status || "planned",
          createdAt: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, activity: data });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

/* ---------- GET /api/activities/:projectId ---------- */
app.get("/api/activities/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { data, error } = await supabase.from("activities").select("*").eq("projectId", projectId);
    if (error) throw error;
    res.json({ success: true, activities: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// MRV
// ==========================================================

/* ---------- POST /api/mrv ---------- */
app.post("/api/mrv", async (req, res) => {
  try {
    const { projectId, date, type, source, ndvi, evi, carbonStock, changeDetection, status } = req.body;

    if (!projectId || !date || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from("mrv_data")
      .insert([
        {
          projectId,
          date,
          type,
          source,
          ndvi,
          evi,
          carbonStock,
          changeDetection,
          status: status || "pending",
          createdAt: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, mrv: data });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

/* ---------- GET /api/mrv/:projectId ---------- */
app.get("/api/mrv/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { data, error } = await supabase.from("mrv_data").select("*").eq("projectId", projectId);
    if (error) throw error;
    res.json({ success: true, mrv: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// START SERVER
// ==========================================================
app.listen(PORT, () => {
  console.log(`✅ Backend API listening on http://localhost:${PORT}`);
});



