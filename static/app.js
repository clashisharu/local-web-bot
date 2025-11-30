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


const fileList = document.getElementById("fileList");
const refreshFilesBtn = document.getElementById("refreshFiles");
const commandInput = document.getElementById("commandInput");
const runCommandBtn = document.getElementById("runCommandBtn");
const commandOutput = document.getElementById("commandOutput");

function refreshFiles() {
  fetch("/files")
    .then(res => res.json())
    .then(data => {
      fileList.innerHTML = "";
      if (data.files) {
        data.files.forEach(f => {
          const li = document.createElement("li");
          li.textContent = `${f.name} (${f.size} bytes)`;

          const runBtn = document.createElement("button");
          runBtn.textContent = "Run";
          runBtn.style.marginLeft = "0.5rem";
          runBtn.addEventListener("click", () => runFile(f.name));

          li.appendChild(runBtn);
          fileList.appendChild(li);
        });
      }
    });
}

refreshFiles();

function renderExecutionResult({ stdout = "", stderr = "", returncode }, filename) {
  const ts = new Date().toLocaleString();
  const isError = !!stderr.trim() || returncode !== 0;

  // Build formatted text with explicit sections
  const text =
    `Running: ${filename}\n` +
    `Time: ${ts}\n` +
    `\nSTDOUT:\n${stdout || "(no output)"}\n` +
    `\nSTDERR:\n${stderr || "(no errors)"}\n` +
    `\nReturn code: ${returncode}\n`;

  // Apply class for success or error
  commandOutput.classList.toggle("exec-error", isError);
  commandOutput.classList.toggle("exec-success", !isError);

  // Write the text
  commandOutput.textContent = text;
}

function runFile(filename) {
  commandOutput.textContent = `Running file: ${filename}...\n`;
  fetch("/run_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename })
  })
    .then(res => res.json())
    .then(data => {
      renderExecutionResult(data, filename);
    });
}


refreshFilesBtn.addEventListener("click", refreshFiles);
const sidebar = document.getElementById("sidebar");
const openSidebarBtn = document.getElementById("openSidebarBtn");
const closeSidebarBtn = document.getElementById("closeSidebar");

openSidebarBtn.addEventListener("click", () => {
  sidebar.classList.add("active");
  openSidebarBtn.classList.add("hidden");
});

closeSidebarBtn.addEventListener("click", () => {
  sidebar.classList.remove("active");
  openSidebarBtn.classList.remove("hidden");
});
