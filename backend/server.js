const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { create } = require('ipfs-http-client');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// In-memory storage for documents and checkpoints
let documents = {};
let checkpoints = {};

// Routes
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileName = req.file.filename;
  const filePath = req.file.path;
  const fileHash = `Qm${Math.random().toString(36).substr(2, 23)}`; // Mock IPFS hash
  
  documents[fileName] = {
    originalName: req.file.originalname,
    path: filePath,
    hash: fileHash,
    uploadedAt: new Date().toISOString()
  };

  res.json({
    success: true,
    fileName,
    hash: fileHash,
    message: 'File uploaded successfully'
  });
});

app.get('/api/document/:fileName', (req, res) => {
  const { fileName } = req.params;
  const document = documents[fileName];

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  res.json(document);
});

app.get('/api/checkpoints/:shipmentId', (req, res) => {
  const { shipmentId } = req.params;
  const shipmentCheckpoints = checkpoints[shipmentId] || [];
  
  res.json(shipmentCheckpoints);
});

app.post('/api/checkpoints/:shipmentId', (req, res) => {
  const { shipmentId } = req.params;
  const { location, temperature, humidity, dataHash } = req.body;

  if (!checkpoints[shipmentId]) {
    checkpoints[shipmentId] = [];
  }

  const checkpoint = {
    id: checkpoints[shipmentId].length + 1,
    location,
    temperature,
    humidity,
    dataHash,
    timestamp: new Date().toISOString()
  };

  checkpoints[shipmentId].push(checkpoint);

  res.json({
    success: true,
    checkpoint
  });
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});