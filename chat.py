from gpt4all import GPT4All
from flask import Flask, Response, request, render_template, jsonify, stream_with_context
import os, re, base64, subprocess, threading, time

CODE_DIR = ".\code"
MODEL_DIR = r"D:\projects\GPT4ALL\models"

app = Flask(__name__)

# In-memory session store: session_id -> {"model": GPT4All, "chat": chat_session_ctx, "lock": threading.Lock()}
SESSIONS = {}
SESSIONS_LOCK = threading.Lock()

# Maximum allowed concurrent sessions
MAX_SESSIONS = 5   # adjust as needed

# --- Utility: list models ---
def list_models():
    return [f.replace(".gguf", "") for f in os.listdir(MODEL_DIR) if f.endswith(".gguf")]

@app.route("/models", methods=["GET"])
def get_models():
    return jsonify({"models": list_models()})

def load_model_for_session(session_id: str, model_name: str):
    """Load model and create isolated chat session for a given session_id."""
    with SESSIONS_LOCK:
        # Check if session already exists
        if session_id in SESSIONS:
            # Replace existing session
            pass
        else:
            # Enforce max sessions
            if len(SESSIONS) >= MAX_SESSIONS:
                raise RuntimeError("Maximum number of sessions reached. Try again later.")

        model_path = os.path.join(MODEL_DIR, model_name) + ".gguf"
        model = GPT4All(model_path)

        chat_ctx = model.chat_session(system_prompt="""
        You are an assistant that always replies in English.
        Always format your responses using valid Markdown syntax so they can be parsed by marked.js.
        - Use fenced code blocks with language identifiers for code
        ```language
        <code here>
        - Use proper line breaks using \\n and double \\n for paragraph breaks.
        - Use proper syntax for code blocks, the code should be directly executable.
        - Use lists (- or 1.) for steps.
        - Use headings (#, ##) when appropriate.
        Do not output raw HTML tags like <code> or <p>.
        """)
        chat_ctx.__enter__()

        SESSIONS[session_id] = {
            "model": model,
            "chat": chat_ctx,
            "lock": threading.Lock(),
            "model_name": model_name,
            "loaded_at": time.time(),
        }


def get_session(session_id: str):
    """Fetch session; return None if missing."""
    with SESSIONS_LOCK:
        return SESSIONS.get(session_id)

def require_session(session_id: str):
    s = get_session(session_id)
    if s is None:
        return None, jsonify({"error": "Invalid or missing session_id. Load a model first."}), 400
    return s, None, None

# --- Select/load model for a specific session ---
@app.route("/select_model", methods=["POST"])
def select_model():
    data = request.get_json()
    session_id = data.get("session_id")
    model_name = data.get("model")

    if not session_id:
        return jsonify({"error": "session_id is required"}), 400
    if not model_name or model_name not in list_models():
        return jsonify({"error": "Invalid model name"}), 400

    try:
        load_model_for_session(session_id, model_name)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 429  # Too Many Requests

    return jsonify({"message": f"Model {model_name} loaded successfully for session {session_id}."})


# --- Index page ---
@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")

# --- Streaming endpoint (per session) ---
@app.route("/stream", methods=["GET"])
def stream():
    session_id = request.args.get("session_id", "").strip()
    prompt = request.args.get("prompt", "").strip()
    max_tokens = int(request.args.get("max_tokens", 500))
    temp = float(request.args.get("temp", 0.7))
    top_p = float(request.args.get("top_p", 0.9))

    if not session_id:
        return jsonify({"error": "session_id is required"}), 400
    if not prompt:
        return jsonify({"error": "Empty prompt"}), 400

    session, err_resp, err_code = require_session(session_id)
    if err_resp:
        return err_resp, err_code

    model = session["model"]
    lock = session["lock"]

    def event_stream():
        try:
            yield "data: [PROCESSING]\n\n"
            buffer = ""
            token_count = 0

            # Prevent interleaved token streaming per session
            with lock:
                for token in model.generate(
                    prompt,
                    max_tokens=max_tokens,
                    temp=temp,
                    top_p=top_p,
                    streaming=True
                ):
                    token_count += 1
                    print(f"[{session_id}] TOKEN {token_count}: {repr(token)}", flush=True)
                    buffer += token
                    safe_token = base64.b64encode(token.encode()).decode()
                    yield f"data: {safe_token}\n\n"

            # Extract code blocks after generation completes
            code_blocks = re.findall(r"```(\w+)?\n([\s\S]*?)```", buffer)
            if code_blocks:
                os.makedirs(CODE_DIR, exist_ok=True)
                for idx, (lang, code) in enumerate(code_blocks, start=1):
                    language = (lang or "plain").lower()
                    code_text = code.strip()
                    ext_map = {
                        "python": "py", "javascript": "js", "java": "java",
                        "c": "c", "cpp": "cpp", "html": "html", "css": "css",
                        "json": "json", "bash": "sh", "plain": "txt"
                    }
                    extension = ext_map.get(language, "txt")
                    safe_prefix = re.sub(r"[^A-Za-z0-9_\-]", "_", prompt[:20])
                    filename = os.path.join(CODE_DIR, f"{safe_prefix}_{idx}.{extension}")

                    with open(filename, "w", encoding="utf-8") as f:
                        f.write(code_text)

                    # Simple log line (avoid huge JSON file growth in production)
                    print(f"[{session_id}] Saved code block #{idx} to {filename}", flush=True)

            print(f"[{session_id}] Total tokens generated: {token_count}", flush=True)
            yield "data: [DONE]\n\n"

        except Exception as e:
            err_msg = f"[ERROR] {str(e)}"
            safe_err = base64.b64encode(err_msg.encode()).decode()
            yield f"data: {safe_err}\n\n"
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

# --- File manager endpoints (unchanged) ---
@app.route("/files", methods=["GET"])
def list_files():
    try:
        if not os.path.exists(CODE_DIR):
            return jsonify({"files": []})
        files = []
        for f in os.listdir(CODE_DIR):
            path = os.path.join(CODE_DIR, f)
            if os.path.isfile(path):
                files.append({
                    "name": f,
                    "size": os.path.getsize(path),
                    "modified": os.path.getmtime(path)
                })
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/run_file", methods=["POST"])
def run_file():
    data = request.get_json()
    filename = data.get("filename")
    if not filename:
        return jsonify({"error": "No filename provided"}), 400

    filepath = os.path.join(CODE_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"error": "File not found"}), 404

    try:
        ext = os.path.splitext(filename)[1].lower()
        if ext == ".py":
            cmd = ["python", filepath]
        elif ext == ".js":
            cmd = ["node", filepath]
        elif ext == ".sh":
            cmd = ["bash", filepath]
        elif ext == ".java":
            # compile + run
            compile_result = subprocess.run(["javac", filepath], capture_output=True, text=True)
            if compile_result.returncode != 0:
                return jsonify({
                    "stdout": compile_result.stdout,
                    "stderr": compile_result.stderr,
                    "returncode": compile_result.returncode
                })
            cmd = ["java", os.path.splitext(filename)[0]]
        else:
            return jsonify({"error": f"Unsupported file type: {ext}"}), 400

        result = subprocess.run(cmd, capture_output=True, text=True)
        return jsonify({
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # For production, use a WSGI server (e.g., gunicorn) and set workers appropriately.
    app.run(host="0.0.0.0", port=5000, debug=True)
