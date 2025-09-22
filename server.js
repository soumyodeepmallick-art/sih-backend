// server.js
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// File where we persist submissions
const DB_FILE = path.join(__dirname, "submissions.json");

// Multer configuration: keep file in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/* ---------- Helpers ---------- */
async function loadSubmissions() {
  try {
    const data = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}
async function saveSubmissions(arr) {
  await fs.writeFile(DB_FILE, JSON.stringify(arr, null, 2), "utf8");
}

/* ---------- POST /submitData ---------- 
   Frontend form uploads: name, description, latitude, longitude, image
*/
app.post("/submitData", upload.single("image"), async (req, res) => {
  try {
    const { body, file } = req;

    if (!body || !body.description) {
      return res
        .status(400)
        .json({ error: "Missing required field: description" });
    }
    if (!file) {
      return res
        .status(400)
        .json({ error: 'Missing image file (field name must be "image")' });
    }

    // Build FormData for Pinata
    const form = new FormData();
    form.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
      knownLength: file.size,
    });

    const meta = {
      name: file.originalname,
      keyvalues: {
        uploader: body.name || "anonymous",
        description: body.description || "",
      },
    };
    form.append("pinataMetadata", JSON.stringify(meta));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      return res
        .status(500)
        .json({ error: "Pinata JWT not configured on server" });
    }

    const pinataResp = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${pinataJwt}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const ipfsHash = pinataResp.data?.IpfsHash;
    const ipfsUrl = ipfsHash
      ? `https://gateway.pinata.cloud/ipfs/${ipfsHash}`
      : null;

    const submission = {
      id: uuidv4(),
      applicantAddress: body.applicantAddress || null,
      title: body.name || null,
      description: body.description || null,
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

    const submissions = await loadSubmissions();
    submissions.push(submission);
    await saveSubmissions(submissions);

    return res.status(201).json({ success: true, submission });
  } catch (err) {
    console.error("Error /submitData:", err?.response?.data || err.message);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

/* ---------- GET /api/submissions ---------- */
app.get("/api/submissions", async (req, res) => {
  try {
    const submissions = await loadSubmissions();
    return res.json(submissions);
  } catch (err) {
    console.error("Error /api/submissions:", err);
    return res.status(500).json({ error: "Failed to read submissions" });
  }
});

/* ---------- GET /api/submissions/:id/metadata ---------- */
app.get("/api/submissions/:id/metadata", async (req, res) => {
  try {
    const submissions = await loadSubmissions();
    const sub = submissions.find((s) => s.id === req.params.id);
    if (!sub) return res.status(404).json({ error: "Not found" });

    // Metadata URI (can be imageUrl or a JSON metadata if you extend this)
    return res.json({ metadataURI: sub.imageUrl });
  } catch (err) {
    console.error("Error /api/submissions/:id/metadata:", err);
    return res.status(500).json({ error: "Error fetching metadata" });
  }
});

/* ---------- POST /api/submissions/:id/minted ---------- */
app.post("/api/submissions/:id/minted", async (req, res) => {
  try {
    const { txHash, tokenId, metadataURI } = req.body;
    const submissions = await loadSubmissions();
    const idx = submissions.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });

    submissions[idx] = {
      ...submissions[idx],
      status: "approved",
      txHash,
      tokenId,
      metadataURI,
    };

    await saveSubmissions(submissions);
    res.json({ success: true, submission: submissions[idx] });
  } catch (err) {
    console.error("Error /api/submissions/:id/minted:", err);
    res.status(500).json({ error: "Failed to mark minted" });
  }
});

/* ---------- Start server ---------- */
app.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});


