
  // configure marked to use highlight.js
  marked.setOptions({
    breaks: true, // treat single line breaks as <br>
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

  function appendMessage(role, text, isMarkdown = false) {
    const msg = document.createElement("div");
    msg.className = `msg ${role}`;
    if (isMarkdown) {
      msg.innerHTML = `<strong>${role}:</strong><div class="content">${marked.parse(text)}</div>`;
    } else {
      msg.textContent = `${role}: ${text}`;
    }
    chatWindow.appendChild(msg);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    appendMessage("You", prompt);
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
    appendMessage("Assistant", "Thinking...");
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
