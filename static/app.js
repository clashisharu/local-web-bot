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

let currentModel = null;
let modelLoaded = false;

// --- Generate a session_id for this client ---
const sessionId = "sess-" + Math.random().toString(36).substring(2, 10);

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

  if (modelLoaded && currentModel === selectedModel) {
    appendMessage(statusDiv, "System", `Model "${selectedModel}" is already loaded.`, false, true);
    return;
  }

  fetch("/select_model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, model: selectedModel })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert("Error: " + data.error);
      } else {
        appendMessage(statusDiv, "System", data.message, false, true);
        modelLoaded = true;
        currentModel = selectedModel;
      }
    });
});

// --- Append messages ---
function appendMessage(targetElement, role, text, isMarkdown = false, clear = false) {
  const tempdiv = document.createElement("div");
  if (clear) targetElement.innerHTML = "";

  if (targetElement === chatWindow) {
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

  appendMessage(chatWindow, "You", prompt);
  promptInput.value = "";

  const maxTokens = parseInt(maxTokensInput.value, 10);
  const temp = parseFloat(tempInput.value);
  const topP = parseFloat(topPInput.value);

  // Open SSE stream with session_id
  const params = new URLSearchParams({
    session_id: sessionId,
    prompt,
    max_tokens: maxTokens,
    temp,
    top_p: topP
  });

  const eventSource = new EventSource(`/stream?${params.toString()}`);

  let buffer = "";
  eventSource.onmessage = (event) => {
    if (event.data === "[PROCESSING]") {
      appendMessage(chatWindow, "Assistant", "Thinking...");
      return;
    }
    if (event.data === "[DONE]") {
      console.log("Stream finished.");
      eventSource.close();
      return;
    }
    const chunk = atob(event.data);
    buffer += chunk;
    const last = chatWindow.querySelector(".msg.Assistant:last-child");
    if (last) {
      last.innerHTML = marked.parse(buffer);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    appendMessage(chatWindow, "System", "Stream error or session limit reached.", false);
  };
});

// --- File manager ---
const fileList = document.getElementById("fileList");
const refreshFilesBtn = document.getElementById("refreshFiles");
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
          // Add a line break
          li.appendChild(document.createElement("br"));

          // Run button
          const runBtn = document.createElement("button");
          runBtn.textContent = "Run";
          runBtn.style.marginLeft = "0.5rem";
          runBtn.addEventListener("click", () => runFile(f.name));
          li.appendChild(runBtn);

          // Open IDE button
          const ideBtn = document.createElement("button");
          ideBtn.textContent = "Open";
          ideBtn.style.marginLeft = "0.5rem";
          ideBtn.addEventListener("click", () => openIde(f.name));
          li.appendChild(ideBtn);

          fileList.appendChild(li);
        });
      }
    });
}

// IDE popup logic
const idePopup = document.getElementById("idePopup");
const ideEditor = document.getElementById("ideEditor");
const ideFilename = document.getElementById("ideFilename");
const closeIdePopup = document.getElementById("closeIdePopup");

function openIde(filename) {
  fetch(`/file_content?filename=${encodeURIComponent(filename)}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert("Error: " + data.error);
        return;
      }
      ideFilename.textContent = data.filename;
      ideEditor.value = data.content;
      idePopup.classList.remove("hidden");
    });
}

closeIdePopup.addEventListener("click", () => {
  idePopup.classList.add("hidden");
});

refreshFiles();

function renderExecutionResult({ stdout = "", stderr = "", returncode }, filename) {
  const ts = new Date().toLocaleString();
  const isError = !!stderr.trim() || returncode !== 0;
  const text =
    `Running: ${filename}\nTime: ${ts}\n\nSTDOUT:\n${stdout || "(no output)"}\n\nSTDERR:\n${stderr || "(no errors)"}\n\nReturn code: ${returncode}\n`;
  commandOutput.classList.toggle("exec-error", isError);
  commandOutput.classList.toggle("exec-success", !isError);
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

// --- Sidebar toggle ---
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

// --- IDE popup actions ---
const saveFileBtn = document.getElementById("saveFileBtn");
const deleteFileBtn = document.getElementById("deleteFileBtn");

saveFileBtn.addEventListener("click", () => {
  const filename = ideFilename.textContent;
  const content = ideEditor.value;
  fetch("/update_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content })
  })
    .then(res => res.json())
    .then(data => {
      alert(data.message || data.error);
      refreshFiles();
      idePopup.classList.add("hidden");
    });
});

deleteFileBtn.addEventListener("click", () => {
  const filename = ideFilename.textContent;
  if (!confirm(`Delete ${filename}?`)) return;
  fetch("/delete_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename })
  })
    .then(res => res.json())
    .then(data => {
      alert(data.message || data.error);
      refreshFiles();
      idePopup.classList.add("hidden");
    });
});

// --- New File popup actions ---
const newFilePopup = document.getElementById("newFilePopup");
const newFileBtn = document.getElementById("newFileBtn");
const closeNewFilePopup = document.getElementById("closeNewFilePopup");
const createFileBtn = document.getElementById("createFileBtn");
const newFilename = document.getElementById("newFilename");
const newFileContent = document.getElementById("newFileContent");

newFileBtn.addEventListener("click", () => {
  newFilename.value = "";
  newFileContent.value = "";
  newFilePopup.classList.remove("hidden");
});

closeNewFilePopup.addEventListener("click", () => {
  newFilePopup.classList.add("hidden");
});

createFileBtn.addEventListener("click", () => {
  const filename = newFilename.value.trim();
  const content = newFileContent.value;
  if (!filename) {
    alert("Filename required");
    return;
  }
  fetch("/create_file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content })
  })
    .then(res => res.json())
    .then(data => {
      alert(data.message || data.error);
      refreshFiles();
      newFilePopup.classList.add("hidden");
    });
});
