# Urai · Diagnosa Honda BeAT

A 3D Honda BeAT (eSAF frame, 2020 onward) you can take apart part by part, with a chat that turns a described problem into suspected parts lit up on the model, likely causes and what to do.

## What's inside

- `lib/parts.ts`: 51 parts with function, location, specs and service notes. Specs come from the BEAT/BEAT STREET owner's manual (00X3H-K1A-N000).
- `lib/symptoms.ts`: 33 symptoms (CVT shudder and noise, sluggish pull, misfire, hard start, no crank, Idling Stop, idle, fuel use, brakes, engine noise, overheating, leaks, smoke, battery, lights, steering, suspension, frame corrosion, fuel smell, flood water) plus the 10 PGM-FI blink codes. Each maps to parts with a likelihood, causes, checks, fixes marked DIY or workshop, and a safety level.
- `lib/retrieve.ts`: matches a message to symptoms (Indonesian, workshop slang and English) and reads blink codes ("kedip 12", "panjang 2 pendek 1").
- `lib/server/ai.ts`: sends the message, the part list and the matching knowledge-base entries to an open-weight model (Groq free tier by default). The model may only name parts from the catalog; its JSON is validated, and it can never lower a "stop" safety level from the knowledge base. If the AI is missing, rate-limited or fails, the answer comes straight from the knowledge base.
- `lib/model.ts`: the procedural 3D model (Three.js). Stylized, not CAD: sizes follow the spec sheet, positions are approximate.
- `components/Viewer.tsx`: explode, see-through bodywork, tap a part for details, suspected parts glow (red most likely, amber possible, yellow check too) while the rest turns see-through, and the camera turns to the side the parts sit on.

## Deploy (Vercel)

1. Push this folder to a new GitHub repo, then import it in Vercel.
2. Add `AI_API_KEY`: a Groq key from console.groq.com (free, no card). The Piring key works too.
3. Deploy. Without a key the app still works in knowledge-base mode.

Optional: `AI_BASE_URL` and `AI_MODEL` for any other OpenAI-compatible endpoint. Default model `qwen/qwen3.8-27b`.

## Limits

- Advice only; brakes, frame cracks and fuel leaks are always flagged "don't ride".
- Groq's free tier is limited per minute and per day; when it's busy the app says so and answers from the knowledge base.

## Local

```bash
npm install
cp .env.example .env.local   # add AI_API_KEY
npm run dev
```

## Font

Chakra Petch, SIL Open Font License (`app/fonts/OFL.txt`).
