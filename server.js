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

// Allow frontend requests

app.use(
  cors({
    origin: "*", // or ["http://localhost:5173", "https://your-frontend-domain.com"]
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

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

/* ---------- POST /api/submissions ---------- 
   FormData fields:
   - applicantAddress (string)
   - name (string)
   - description (string)
   - latitude, longitude (optional)
   - file (image)
*/
app.post("/api/submissions", upload.single("file"), async (req, res) => {
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
        .json({ error: 'Missing file (field name must be "file")' });
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
    console.error("Error /api/submissions:", err?.response?.data || err.message);
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
/* ---------- GET /api/submissions/:id/metadata ---------- */
app.get("/api/submissions/:id/metadata", async (req, res) => {
  try {
    const submissions = await loadSubmissions();
    const sub = submissions.find((s) => s.id === req.params.id);
    if (!sub) return res.status(404).json({ error: "Not found" });

    // NFT Metadata JSON
    const metadata = {
      name: sub.title || "Untitled Submission",
      description: sub.description || "",
      image: sub.imageUrl,
      metadataURI: sub.imageUrl, // <-- added this line for frontend
      attributes: [
        { trait_type: "Applicant Address", value: sub.applicantAddress },
        { trait_type: "Latitude", value: sub.latitude },
        { trait_type: "Longitude", value: sub.longitude },
      ],
    };

    return res.json(metadata);
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


