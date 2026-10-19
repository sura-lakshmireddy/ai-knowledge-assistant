# StudyLamp – Personal AI Knowledge Assistant

Upload study material (PDF, DOCX, TXT, MD, CSV, HTML), chat with an AI tutor, get key points / bullet summaries,
take AI-generated mock tests and earn points, levels and badges.

**Stack:** Node.js · Express · MongoDB (Mongoose) · JWT auth · Gemini API · plain HTML/CSS/JS frontend

## Run in VS Code
1. Install **Node.js 18+** and **MongoDB** (local Community Server, or a free MongoDB Atlas URI).
2. Open this folder in VS Code → open the terminal (Ctrl + `).
3. Edit `.env`:
   - `MONGO_URI` – default works for local MongoDB
   - `GEMINI_API_KEY` – get one from [Google AI Studio](https://aistudio.google.com/app/apikey)
   - `GEMINI_MODEL` – comma-separated Gemini models to try in order if a model is unavailable
   - `GEMINI_TIMEOUT_MS` – request timeout in milliseconds
4. Run:
   ```
   npm install
   npm start
   ```
5. Open http://localhost:3000, create an account and start learning.

## Rewards
- 10 points per correct answer, +20 bonus for a perfect score
- Level up every 100 points
- Badges: First Test, Perfect Score, 5 Tests Done, 500 Points, Level 5

## Structure
- `server.js` – API (auth, upload, chat, tests, leaderboard)
- `models.js` – MongoDB schemas (files are stored in MongoDB)
- `public/` – frontend

## Deploy on Render
Create a **Web Service** from this repository and configure:
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment:** set `MONGO_URI` to the Atlas connection string, `JWT_SECRET` to a long random secret, and `GEMINI_API_KEY` to your Google AI Studio key. Set `GEMINI_MODEL` if you want to override the default.

In MongoDB Atlas, add the Render service's outbound IP addresses under **Security → Network Access**. If your Render plan does not provide stable outbound IP addresses, `0.0.0.0/0` can be used as a temporary connectivity check, but it allows connections from any IP; use a strong database password and restrict access when possible. Also confirm the Atlas database user and password are correct, and URL-encode any special characters in the password in `MONGO_URI`.

`DNS_SERVERS` does not change Atlas IP access rules. Only set it if DNS resolution itself is failing. Keep `.env` local; configure production values in Render's environment settings instead.
