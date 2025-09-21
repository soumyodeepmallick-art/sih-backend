# sih-backend

This is the backend API for the **SIH Project**, built with **Node.js + Express**.  
It allows uploading images along with metadata (name, description, location) to **IPFS** via **Pinata**, and retrieving all saved submissions.

---

## 🚀 Features
- Upload image + metadata (`/submitData`)
- Store file on **IPFS** using **Pinata JWT**
- Save submissions locally in `submissions.json`
- Retrieve all submissions (`/getSubmissions`)
- Simple `.env` configuration

---

## ⚙️ Setup

### 1. Clone the repository
```bash
git clone https://github.com/soumyodeepmallick-art/sih-backend.git
cd sih-backend
