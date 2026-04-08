// const bubble = document.getElementById("chat-bubble");
// const widget = document.getElementById("chat-widget");
// const closeBtn = document.getElementById("chat-close");
// const chatBody = document.getElementById("chat-body");

// bubble.onclick = () => {
//   widget.style.display = "flex";
//   bubble.style.display = "none";
// };

// closeBtn.onclick = () => {
//   widget.style.display = "none";
//   bubble.style.display = "flex";
// };

// const demoMessages = [
//   "Hello! I’m SurveyBot, a public policy survey chatbot.",
//   "In the live version, I would guide you through a short survey.",
//   "Your responses would be logged securely and anonymously.",
//   "This public demo is non-interactive to avoid collecting data."
// ];

// let index = 0;

// function addBotMessage(text) {
//   const div = document.createElement("div");
//   div.className = "message bot";
//   div.textContent = text;
//   chatBody.appendChild(div);
//   chatBody.scrollTop = chatBody.scrollHeight;
// }

// // Auto-play demo messages
// setInterval(() => {
//   if (index < demoMessages.length) {
//     addBotMessage(demoMessages[index]);
//     index++;
//   }
// }, 2000);

const LIVE_MODE = true; // you want to display the real widget
const PASSWORD = "demo123"; // change this

function injectDfMessenger() {
  const theme = document.createElement("link");
  theme.rel = "stylesheet";
  theme.href =
    "https://www.gstatic.com/dialogflow-console/fast/df-messenger/prod/v1/themes/df-messenger-default.css";

  const script = document.createElement("script");
  script.src =
    "https://www.gstatic.com/dialogflow-console/fast/df-messenger/prod/v1/df-messenger.js";

  document.head.appendChild(theme);
  document.head.appendChild(script);

  script.onload = () => {
    const messenger = document.createElement("df-messenger");
    messenger.setAttribute("location", "northamerica-northeast1");
    messenger.setAttribute("project-id", "YOUR_PROJECT_ID");
    messenger.setAttribute("agent-id", "YOUR_AGENT_ID");
    messenger.setAttribute("language-code", "en");
    messenger.setAttribute("max-query-length", "-1");

    const bubble = document.createElement("df-messenger-chat-bubble");
    bubble.setAttribute("chat-title", "SurveyBot");
    messenger.appendChild(bubble);

    // Style like your earlier snippet
    const style = document.createElement("style");
    style.textContent = `
      df-messenger {
        z-index: 999;
        position: fixed;
        --df-messenger-font-color: #000;
        --df-messenger-font-family: Google Sans;
        --df-messenger-chat-background: #f3f6fc;
        --df-messenger-message-user-background: #d3e3fd;
        --df-messenger-message-bot-background: #fff;
        bottom: 16px;
        right: 16px;
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(messenger);
  };
}

if (LIVE_MODE) {
  // Simple password prompt gate
  const entered = window.prompt("Enter demo password to load the live chatbot UI:");
  if (entered === PASSWORD) {
    injectDfMessenger();
  } else {
    document.getElementById("chat-root").innerHTML = `
      <div class="demo-chat">
        <strong>SurveyBot</strong>
        <p>Live UI locked. Incorrect password.</p>
      </div>
    `;
  }
}

