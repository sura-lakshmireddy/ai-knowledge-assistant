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
