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
  "sessionID", "timestamp", "completion_status",
  "age", "gender", "nationality", "borough", "education", "occupation",
  "STM_usage", "STM_reliability", "STM_affordability", "Hydro_sustainability","Hydro_equity", "comments"
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

const qFields = {
  1: "STM_usage",
  2: "STM_reliability", 
  3: "STM_affordability",
  4: "Hydro_sustainability",
  5: "Hydro_equity"
};

const demographicHandlers = {
  demographics1: "age",
  demographics2: "gender",
  demographics3: "nationality",
  demographics4: "borough",
  demographics5: "education",
  demographics6: "occupation",
};

const prompts = {
  en: {
    Q1: "How often do you use STM public transit in a typical week?",
    Q2: "How satisfied are you with the reliability of STM service?",
    Q3: "How affordable do you find STM fares relative to the service you receive?",
    Q4: "How informed do you feel about Hydro-Québec's energy transition and sustainability initiatives?",
    Q5: "Do you believe Hydro-Québec's rate structures are fair across different income levels?"
  },
  fr: {
    Q1: "À quelle fréquence utilisez-vous le transport en commun de la STM pendant une semaine typique?",
    Q2: "Quel est votre niveau de satisfaction concernant la fiabilité du service STM?",
    Q3: "Trouvez-vous que les tarifs de la STM sont abordables compte tenu du service offert?",
    Q4: "Dans quelle mesure vous sentez-vous informé(e) des initiatives de transition énergétique et de développement durable d'Hydro-Québec?",
    Q5: "Croyez-vous que les structures tarifaires d'Hydro-Québec sont équitables pour les différents niveaux de revenus?"
  }
  
};

const demographicsURLBase = "projects/public-policy-chatbot/locations/northamerica-northeast1/agents/20c6fb51-3364-4ecd-9fe2-73203361287a/flows/a11e5871-3849-4231-9d82-cfd567b02ea7/pages";
const questionsURLBase = "projects/public-policy-chatbot/locations/northamerica-northeast1/agents/20c6fb51-3364-4ecd-9fe2-73203361287a/flows/f7e22aeb-3ff8-4798-a26c-77f345b9566c/pages";
const targetPages = {
  demographics1: `${demographicsURLBase}/be036510-ff6e-4093-a107-9a1386bcf3d8`,
  demographics2: `${demographicsURLBase}/2c7f535c-7bdb-497e-9ff8-3a4a3805fdfc`,
  demographics3: `${demographicsURLBase}/5cf5140d-c686-4760-a322-315ecb387a92`,
  demographics4: `${demographicsURLBase}/eb68ecfe-59dc-4af6-b0bc-71919002f571`,
  demographics5: `${demographicsURLBase}/71179be0-55c9-4023-a366-6325bd1f2138`,
  demographics6: "projects/public-policy-chatbot/locations/northamerica-northeast1/agents/20c6fb51-3364-4ecd-9fe2-73203361287a/flows/f7e22aeb-3ff8-4798-a26c-77f345b9566c",
  q1_answer: `${questionsURLBase}/8f9d1e08-1079-45d9-a516-9afb94da49e8`, // Page 2's URL
  q2_answer: `${questionsURLBase}/7f43a35c-abcc-4cbf-8cab-08bd1c1aa131`,
  q3_answer: `${questionsURLBase}/3d1565fb-6b5e-4150-ad73-02b16c220723`, 
  q4_answer: `${questionsURLBase}/8f794b33-4554-40d4-acf4-1641e1de7899`, 
  q5_answer: `${questionsURLBase}/a727282a-e530-4e46-a813-07da1a2f28ac`, // Links to 'Comments'
};

function handleQ(n, sessionId, rawText, isSkip) {
  ensureSession(sessionId);
  if (!isSkip) {
    const field = qFields[n];
    sessions[sessionId][field] = rawText;
    console.log(`[${sessionId}] ${field}:`, rawText);
  }
}

async function handleQuestionTag(tag, sessionId, params, rawText, lang, isSkip, res) {
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
    const intentName = req.body.intentInfo?.displayName || "";
    const isSkip = intentName === "Skip Question";
    console.log("intentName:", intentName);
    console.log("isSkip:", isSkip);
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
    } else if (tag in demographicHandlers) {
        const param = demographicHandlers[tag];
        ensureSession(sessionId);

        if (!isSkip) {
          sessions[sessionId][param] = param === "age" ? params.age : rawText;
          console.log(`[${sessionId}] ${param}:`, sessions[sessionId][param]);
        }

        const isLastDemographic = tag === "demographics6";
        return res.status(200).json(
          isLastDemographic
            ? { targetFlow: targetPages[tag] }
            : { targetPage: targetPages[tag] }
        );
    } else if (tag === "comments") {
        ensureSession(sessionId);
        if (!isSkip) {
          sessions[sessionId].comments = rawText;
          console.log(`[${sessionId}] comments:`, rawText);
        }
        return res.status(200).json({
          targetPage: `${questionsURLBase}/404db1b2-70a4-4b15-9780-5ed0db8cc13a` // Links to 'End Conversation'
        });
    } else if (tag in targetPages) {
        return await handleQuestionTag(tag, sessionId, params, rawText, lang, isSkip, res);
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
  const rows = csv.trim().split("\n").map(row =>
    row.match(/(".*?"|[^,]+)(?=,|$)/g).map(cell =>
      cell.replace(/^"|"$/g, "").replace(/""/g, '"')
    )
  );

  const headers = rows[0];
  const data = rows.slice(1);

  const headerHTML = headers.map(h => `<th>${h}</th>`).join("");

  const rowsHTML = data.map(row => {
    const cells = headers.map((h, i) => {
      const val = row[i] || "";
      if (h === "completion_status") {
        return `<td><span class="badge ${val}">${val}</span></td>`;
      }
      return `<td>${val || '<span class="empty">—</span>'}</td>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Survey Responses</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Google Sans, sans-serif; background: #f8f9fc; padding: 48px; color: #333; }
    h1 { font-size: 1.5rem; font-weight: 600; color: #1a1a2e; margin-bottom: 6px; letter-spacing: -0.3px; }
    .meta { font-size: 0.82rem; color: #888; margin-bottom: 28px; }
    .table-wrapper { background: white; border-radius: 12px; overflow-x: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.04); }
    table { border-collapse: collapse; width: 100%; min-width: 900px; }
    thead tr { border-bottom: 1.5px solid #e8eaf0; }
    th { padding: 14px 20px; text-align: left; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #1a1a2e; background: #7fbefd; border-right: 1px solid #5aaef0; white-space: nowrap; }
    th:last-child { border-right: none; }
    td { padding: 13px 20px; font-size: 0.85rem; color: #444; border-right: 1px solid #f0f1f5; border-bottom: 1px solid #f5f6f9; vertical-align: top; max-width: 200px; }
    td:last-child { border-right: none; }
    tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: #fafbff; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 0.75rem; font-weight: 500; }
    .badge.complete { background: #e6f4ea; color: #2d7a3a; }
    .badge.partial { background: #fff3e0; color: #b36200; }
    .empty { color: #ccc; font-style: italic; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Survey Responses</h1>
  <p class="meta">${data.length} response${data.length !== 1 ? "s" : ""} collected</p>
  <div class="table-wrapper">
    <table>
      <thead><tr>${headerHTML}</tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>
  </div>
</body>
</html>`;

  res.send(html);
});

app.listen(8080, () => {
  console.log("Webhook listening on port 8080");
});

function saveSessionToCSV(sessionId, status) {
  const sessionData = sessions[sessionId];
  if (!sessionData) return;

  // skip if no meaningful data was collected
  const hasData = Object.entries(sessionData).some(
    ([key, val]) => key !== "timestamp" && val !== "" && val !== null && val !== undefined
  );
  if (!hasData) {
    delete sessions[sessionId];
    return;
  }

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