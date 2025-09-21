// server.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4000;

// Simple CORS: for production, restrict origin to your frontend origin
app.use(cors());
app.use(express.json());

// File where we persist submissions (simple JSON DB)
const DB_FILE = path.join(__dirname, 'submissions.json');

// Multer configuration: keep file in memory (buffer) so we can send directly to Pinata
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit; change if needed
});

/* ---------- Helpers to read/write a JSON file DB ---------- */
async function loadSubmissions() {
  try {
    const data = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return []; // file doesn't exist yet
    throw err;
  }
}
async function saveSubmissions(arr) {
  await fs.writeFile(DB_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

/* ---------- POST /submitData
   Expects:
     - multipart/form-data
     - text fields like: name, description, latitude, longitude (optional)
     - file field: image (single)
*/
app.post('/submitData', upload.single('file'), async (req, res) => {
  try {
    const { body, file } = req;

    // Basic validation
    if (!body || !body.description) {
      return res.status(400).json({ error: 'Missing required field: description' });
    }
    if (!file) {
      return res.status(400).json({ error: 'Missing image file (field name must be "image")' });
    }

    // Build FormData for Pinata
    const form = new FormData();
    form.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
      knownLength: file.size
    });

    // Optional: pass metadata and options to Pinata
    const meta = {
      name: file.originalname,
      keyvalues: {
        uploader: body.name || 'anonymous',
        description: body.description || ''
      }
    };
    form.append('pinataMetadata', JSON.stringify(meta));
    // pinataOptions: set cidVersion (1), etc.
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      return res.status(500).json({ error: 'Pinata JWT not configured on server' });
    }

    // Send to Pinata
    const url = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
    const headers = {
      ...form.getHeaders(),
      Authorization: `Bearer ${pinataJwt}`
    };

    const pinataResp = await axios.post(url, form, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Pinata returned IpfsHash
    const ipfsHash = pinataResp.data?.IpfsHash;
    const ipfsUrl = ipfsHash ? `https://gateway.pinata.cloud/ipfs/${ipfsHash}` : null;

    // Build the submission record
    const submission = {
      id: uuidv4(),
      name: body.name || null,
      description: body.description || null,
      latitude: body.latitude || null,
      longitude: body.longitude || null,
      ipfsHash,
      ipfsUrl,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      createdAt: new Date().toISOString()
    };

    // Persist
    const submissions = await loadSubmissions();
    submissions.push(submission);
    await saveSubmissions(submissions);

    return res.status(201).json({ success: true, submission });
  } catch (err) {
    console.error('Error /submitData:', err?.response?.data || err.message || err);
    return res.status(500).json({ error: 'Server error', details: err?.message });
  }
});

/* ---------- GET /getSubmissions
   Returns the array of saved submissions
*/
app.get('/getSubmissions', async (req, res) => {
  try {
    const submissions = await loadSubmissions();
    return res.json({ submissions });
  } catch (err) {
    console.error('Error /getSubmissions:', err);
    return res.status(500).json({ error: 'Failed to read submissions' });
  }
});

/* ---------- Start server ---------- */
app.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});

