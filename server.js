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

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Allow frontend requests
app.use(
  cors({
    origin: "*", // tighten later for security
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Multer config
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

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

    const meta = {
      name: file.originalname,
      keyvalues: { uploader: body.name || "anonymous", description: body.description || "" },
    };
    form.append("pinataMetadata", JSON.stringify(meta));
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

    // Build submission object
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

    // Insert into Supabase
    const { error } = await supabase.from("submissions").insert([submission]);
    if (error) throw error;

    return res.status(201).json({ success: true, submission });
  } catch (err) {
    console.error("Error /api/submissions:", err.message);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

/* ---------- GET /api/submissions ---------- */
app.get("/api/submissions", async (req, res) => {
  try {
    const { data, error } = await supabase.from("submissions").select("*").order("createdAt", { ascending: false });
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    console.error("Error /api/submissions:", err.message);
    return res.status(500).json({ error: "Failed to fetch submissions" });
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
    return res.json(metadata);
  } catch (err) {
    console.error("Error metadata:", err.message);
    return res.status(500).json({ error: "Error fetching metadata" });
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
    console.error("Error minted:", err.message);
    res.status(500).json({ error: "Failed to mark minted" });
  }
});

/* ---------- Start server ---------- */
app.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});


