from gpt4all import GPT4All
from flask import Flask, Response, request, render_template, jsonify, stream_with_context
import os, re, base64, subprocess

CODE_DIR = "code"

app = Flask(__name__)

MODEL_DIR = r"D:\projects\GPT4ALL\models"

current_model = None
chat_session = None

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
        # Decide interpreter based on extension
        ext = os.path.splitext(filename)[1].lower()
        if ext == ".py":
            cmd = ["python", filepath]
        elif ext == ".js":
            cmd = ["node", filepath]
        elif ext == ".sh":
            cmd = ["bash", filepath]
        elif ext == ".java":
            # compile + run
            cmd = ["javac", filepath]
            subprocess.run(cmd, capture_output=True, text=True)
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


# --- Utility: list models ---
def list_models():
    model_names = [
        f.replace(".gguf", "") 
        for f in os.listdir(MODEL_DIR) 
        if f.endswith(".gguf")
    ]

    return model_names

@app.route("/models", methods=["GET"])
def get_models():
    return jsonify({"models": list_models()})

# --- Load selected model ---
def load_model(model_name):
    global current_model, chat_session
    model_path = os.path.join(MODEL_DIR, model_name)
    current_model = GPT4All(model_path+".gguf")
    chat_session = current_model.chat_session(system_prompt="""
    You are an assistant that always replies in English.
    Always format your responses using valid Markdown syntax so they can be parsed by marked.js.
    - Use fenced code blocks with language identifiers for code 
    ```language
    <code here>
    - Use proper line breaks using \\n and double \\n for paragraph breaks.
    - Use lists (- or 1.) for steps.
    - Use headings (#, ##) when appropriate.
    Do not output raw HTML tags like <code> or <p>.
    """)
    chat_session.__enter__()

@app.route("/select_model", methods=["POST"])
def select_model():
    data = request.get_json()
    model_name = data.get("model")
    if not model_name or model_name not in list_models():
        return jsonify({"error": "Invalid model name"}), 400
    load_model(model_name)
    return jsonify({"message": f"Model {model_name} loaded successfully"})

# --- Index page ---
@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")

# --- Streaming endpoint ---
@app.route("/stream", methods=["GET"])
def stream():
    if current_model is None:
        return jsonify({"error": "No model loaded. Please select a model first."}), 400

    prompt = request.args.get("prompt", "").strip()
    max_tokens = int(request.args.get("max_tokens", 500))
    temp = float(request.args.get("temp", 0.7))
    top_p = float(request.args.get("top_p", 0.9))

    if not prompt:
        return jsonify({"error": "Empty prompt"}), 400

    def event_stream():
        try:
            yield "data: [PROCESSING]\n\n"
            buffer = ""
            token_count = 0
            for token in current_model.generate(
                prompt,
                max_tokens=max_tokens,
                temp=temp,
                top_p=top_p,
                streaming=True
            ):
                token_count += 1
                print(f"TOKEN {token_count}: {repr(token)}", flush=True)
                buffer += token
                safe_token = base64.b64encode(token.encode()).decode()
                yield f"data: {safe_token}\n\n"

            # extract code blocks
            code_blocks = re.findall(r"```(\w+)?\n([\s\S]*?)```", buffer)
            if code_blocks:
                os.makedirs("code", exist_ok=True)
                for idx, (lang, code) in enumerate(code_blocks, start=1):
                    language = (lang or "plain").lower()
                    code_text = code.strip()
                    ext_map = {
                        "python": "py", "javascript": "js", "java": "java",
                        "c": "c", "cpp": "cpp", "html": "html", "css": "css",
                        "json": "json", "bash": "sh", "plain": "txt"
                    }
                    extension = ext_map.get(language, "txt")
                    filename = f"code/{prompt[:20].replace(' ', '_')}_{idx}.{extension}"
                    with open(filename, "w", encoding="utf-8") as f:
                        f.write(code_text)
                    with open("generated_code.json", "a", encoding="utf-8") as f:
                        f.write(f'{{"filename": "{filename}", "language": "{language}", "code": """{code_text}"""}}\n')
                    print(f"Saved code block #{idx} to {filename}")

            print(f"Total tokens generated: {token_count}")
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

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
