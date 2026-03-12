# restaurant-backend

Backend for the Restaurant Management System.

## What this server provides
- REST API under `/api/*`
- Socket.IO realtime updates under `/socket.io`
- Firebase Admin integration (Auth verification + Firestore access)

## Prerequisites
- Node.js 20+ recommended
- A Firebase project with Firestore enabled
- A Firebase **service account** JSON (keep it private)

## Setup
Copy `.env.example` to `.env` and fill values.

Recommended (Windows):
- Set `GOOGLE_APPLICATION_CREDENTIALS` to the service account JSON file path

## Run locally
From `restaurant-backend/`:

```bash
npm install
npm run dev
```

Server runs on `http://localhost:5180`.

## Frontend dev proxy
Your Vite proxy already targets `http://localhost:5180` for:
- `/api`
- `/socket.io`

