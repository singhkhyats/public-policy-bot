// require("dotenv").config(); // Removed for deployment on railway
const express = require("express");
const OpenAI = require("openai");
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const fs = require("fs");
const path = require("path");
const csvFilePath = path.join(__dirname, "survey_responses.csv");
const sessions = {};

const app = express();
app.use(express.json());

const CSV_HEADERS = [
  "sessionID", "timestamp", "completion_status", "lang",
  "age", "gender", "nationality", "borough", "education", "occupation",
  "q1_raw", "q2_raw", "q3_raw"
];

async function getGeneratedResponse(question) {
  console.log("Calling OpenAI with:", question);

  const response = await client.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      {
        role: "system",
        content: `
You are a helpful assistant answering questions about public policies, transit systems, and public organizations in Quebec (e.g., STM, Hydro-Québec, government programs).
You support both English and French — always reply in the same language the user wrote in.
Your goal is to provide accurate, easy-to-understand explanations.

RULES:
- Keep answers concise (2-3 sentences)
- Use simple, clear language (avoid jargon)
- DO NOT invent specific laws, statistics, or policies
- If you are unsure or the question is too specific, say so clearly

CITATIONS:
- Always include 1–2 credible sources when possible
- Prefer official sources (e.g., stm.info, hydroquebec.com, quebec.ca)
- If exact sources are uncertain, say: "You can find more information on [organization]'s official website"
- Do NOT fabricate links or citations

FORMAT:
- First: direct answer
- Then: "Sources:" on a new line
- Then: 1–2 bullet points with source names (not long URLs)

TONE:
- Neutral, factual, and helpful
- Do not give opinions or advice
`
,
      },
      {
        role: "user",
        content: question,
      },
    ],
  });

  console.log("OpenAI response received");
  return response.choices[0].message.content;
}

function looksLikeQuestion(text = "") {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  if (t.includes("?")) return true;

  const starters = ["what", "why", "how", "where", "who", "when", "can", "is", "are", "explain", "describe",
    "qu'est", "que", "quoi", "pourquoi", "comment", "où", "qui", "quand", "est-ce", "expliquez"];
  
  return starters.some(w => t.startsWith(w + " "));
}

const demographicHandlers = {
  "Demographics 1": "age",
  "Demographics 2": "gender",
  "Demographics 3": "nationality",
  "Demographics 4": "borough",
  "Demographics 5": "education",
  "Demographics 6": "occupation",
};

const prompts = {
  en: {
    Q1: "How often do you use STM public transit in a typical week?",
    Q2: "How satisfied are you with the reliability of STM service?",
    Q3: "How affordable do you find STM fares relative to the service you receive?",
  },
  fr: {
    Q1: "À quelle fréquence utilisez-vous le transport en commun de la STM pendant une semaine typique?",
    Q2: "Quel est votre niveau de satisfaction concernant la fiabilité du service STM?",
    Q3: "Trouvez-vous que les tarifs de la STM sont abordables compte tenu du service offert?",
  }
  
};

const pageURLBase = "projects/public-policy-chatbot/locations/northamerica-northeast1/agents/20c6fb51-3364-4ecd-9fe2-73203361287a/flows/f7e22aeb-3ff8-4798-a26c-77f345b9566c/pages";
const targetPages = {
  q1_answer: `${pageURLBase}/8f9d1e08-1079-45d9-a516-9afb94da49e8`, // Page 2's URL
  q2_answer: `${pageURLBase}/7f43a35c-abcc-4cbf-8cab-08bd1c1aa131`,
  q3_answer: `${pageURLBase}/404db1b2-70a4-4b15-9780-5ed0db8cc13a` // Links to 'End Conversation' for now
};

function handleQ(n, sessionId, rawText) {
  ensureSession(sessionId);
  sessions[sessionId][`q${n}_raw`] = rawText;
  console.log(`[${sessionId}] Q${n} Raw:`, rawText);
}

async function handleQuestionTag(tag, sessionId, params, rawText, lang, res) {
  if (!(tag in targetPages)) return false;

  const answeredParam = `${tag}ed`;
  const n = tag.match(/\d+/)[0];

  if (looksLikeQuestion(rawText)) {
    const answer = await getGeneratedResponse(rawText);
    const qKey = `Q${n}`;
    const reprompt = qKey ? prompts[lang][qKey] : "When you're ready, please answer the question.";
    const prefix = lang === "fr" ? "Revenons au sondage... " : "Going back to the survey... ";

    return res.status(200).json({
      fulfillment_response: {
        messages: [
          { text: { text: [answer] } },
          { text: { text: [`${prefix}${reprompt}`] } }
        ]
      },
      sessionInfo: {
        parameters: { [answeredParam]: false }
      }
    });
  }

  handleQ(n, sessionId, rawText);
  console.log(`Setting ${answeredParam} = true`);

  return res.status(200).json({
    sessionInfo: {
      parameters: { [answeredParam]: true }
    },
    targetPage: targetPages[tag]
  });
}

app.post("/webhook", async (req, res) => {
  try {
    const fullSessionId = req.body?.sessionInfo?.session;
    if (!fullSessionId) {
      console.error("Invalid CX payload (missing sessionInfo.session)");
      return res.status(400).send("Invalid payload");
    }

    const sessionId = fullSessionId.split("/").pop();
    const params = req.body.sessionInfo?.parameters || {};
    const page = req.body.pageInfo?.displayName || "UNKNOWN_PAGE";
    const tag = req.body.fulfillmentInfo?.tag || "";
    const rawText = req.body.text || "";
    const lang = req.body.languageCode === "fr" ? "fr" : "en";
    ensureSession(sessionId);
    sessions[sessionId].lang = lang;

    console.log(`Webhook | session=${sessionId} | page=${page} | tag=${tag}`);
    console.log("language:", req.body.languageCode);

    if (tag === "survey_complete") {
      saveSessionToCSV(sessionId, "complete");
      return res.status(200).send("OK");
    } else if (tag === "retain_responses") {
        saveSessionToCSV(sessionId, "partial");
        return res.status(200).send("OK");
    } else if (tag === "delete_responses") {
        delete sessions[sessionId];
        console.log(`Session ${sessionId} deleted on user request`);
        return res.status(200).send("OK");
    } else if (tag in targetPages) {
        return await handleQuestionTag(tag, sessionId, params, rawText, lang, res);
    }

    const demographicKey = Object.keys(demographicHandlers).find(k => page.includes(k));
    if (demographicKey) {
      const param = demographicHandlers[demographicKey];
      ensureSession(sessionId);
      sessions[sessionId][param] = params[param];
      console.log(`[${sessionId}] ${param}:`, params[param]);
    }
    
    return res.status(200).json({});

  } catch (err) {
    console.error("Webhook error stack:", err?.stack || err);
    return res.status(500).send("Internal Server Error");
  }

});

app.get("/responses", (req, res) => {
  if (!fs.existsSync(csvFilePath)) {
    return res.status(404).send("No responses yet");
  }
  const csv = fs.readFileSync(csvFilePath, "utf8");
  res.setHeader("Content-Type", "text/plain");
  res.send(csv);
});

app.listen(8080, () => {
  console.log("Webhook listening on port 8080");
});

function saveSessionToCSV(sessionId, status) {
  const sessionData = sessions[sessionId];
  if (!sessionData) return;
  sessionData.completion_status = status;

  // If file doesn't exist, write headers first
  if (!fs.existsSync(csvFilePath)) {
    fs.writeFileSync(csvFilePath, CSV_HEADERS.join(",") + "\n", "utf8");
  }

  const rowData = { sessionID: sessionId, timestamp: sessionData.timestamp, ...sessionData };

  const values = CSV_HEADERS.map(header => {
    const v = rowData[header];
    if (v === undefined || v === null) return '""';
    return `"${String(v).replace(/"/g, '""')}"`;
  });

  const row = values.join(",") + "\n";

  fs.appendFileSync(csvFilePath, row, "utf8");
  delete sessions[sessionId];
}

function ensureSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = { timestamp: new Date().toISOString() };
  }
}