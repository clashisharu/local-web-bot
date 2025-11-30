// configure marked to use highlight.js
marked.setOptions({
  breaks: true,
  highlight: function(code, lang) {
    return hljs.highlightAuto(code).value;
  }
});

const chatForm = document.getElementById("chat-form");
const promptInput = document.getElementById("prompt");
const chatWindow = document.getElementById("chat-window");

const maxTokensInput = document.getElementById("maxTokens");
const tempInput = document.getElementById("temp");
const topPInput = document.getElementById("topP");

const modelDropdown = document.getElementById("modelDropdown");
const loadModelBtn = document.getElementById("loadModelBtn");

const statusDiv = document.getElementById("status");

let currentModel = null;   // track which model is active
let modelLoaded = false;

// --- Load available models into dropdown ---
fetch("/models")
  .then(res => res.json())
  .then(data => {
    data.models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      modelDropdown.appendChild(opt);
    });
  });

// --- Handle model selection ---
loadModelBtn.addEventListener("click", () => {
  const selectedModel = modelDropdown.value;
  if (!selectedModel) return alert("Please select a model.");
  appendMessage(statusDiv, "System", `Loading model "${selectedModel}"...`, false, true);

  // check if same model is already loaded
  if (modelLoaded && currentModel === selectedModel) {
    appendMessage(statusDiv, "System", `Model "${selectedModel}" is already loaded.`, false, true);
    return; // stop here, no need to reload
  }

  fetch("/select_model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: selectedModel })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert("Error: " + data.error);
      } else {
        appendMessage(statusDiv, "System", data.message, false, true);
        modelLoaded = true;
        currentModel = selectedModel; // update tracker
      }
    });
});


// --- Append messages ---
function appendMessage(targetElement, role, text, isMarkdown = false, clear = false) {
  const tempdiv = document.createElement("div");
  if (clear) {
    targetElement.innerHTML = "";
  }
  if (targetElement === chatWindow ) {
    tempdiv.className = `msg ${role}`;

    if (isMarkdown) {
      tempdiv.innerHTML = `<strong>${role}:</strong><div class="content">${marked.parse(text)}</div>`;
    } else {
      tempdiv.textContent = `${role}: ${text}`;
    }
  } else {
    tempdiv.innerHTML = text;
  }

  targetElement.appendChild(tempdiv);
  targetElement.scrollTop = targetElement.scrollHeight;
}


// --- Chat form submit ---
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!modelLoaded) {
    alert("Please load a model first.");
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt) return;

  appendMessage(chatWindow,"You", prompt);
  promptInput.value = "";

  const maxTokens = parseInt(maxTokensInput.value, 10);
  const temp = parseFloat(tempInput.value);
  const topP = parseFloat(topPInput.value);

  // Open SSE stream
  const eventSource = new EventSource(
    `/stream?prompt=${encodeURIComponent(prompt)}&max_tokens=${maxTokens}&temp=${temp}&top_p=${topP}`
  );

  let buffer = "";
  eventSource.onmessage = (event) => {
    if (event.data === "[PROCESSING]") {
      appendMessage(chatWindow,"Assistant", "Thinking...");
      return;
    }

    if (event.data === "[DONE]") {
      console.log("Stream finished.");
      eventSource.close();
      return;
    }

    // Otherwise it's a base64 chunk
    const chunk = atob(event.data);
    console.log("Received chunk:", JSON.stringify(chunk));

    buffer += chunk;
    const last = chatWindow.querySelector(".msg.Assistant:last-child");
    if (last) {
      last.innerHTML = marked.parse(buffer);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
  };
});
