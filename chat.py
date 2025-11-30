from gpt4all import GPT4All
from flask import Flask, Response, request, render_template, jsonify, stream_with_context
import os, re, base64

app = Flask(__name__)

MODEL_PATH = r"D:\projects\GPT4ALL\models\deepseek-llm-7b-chat.Q4_K_M.gguf"
model = GPT4All(MODEL_PATH)

# open one global chat session with a system prompt
chat_session = model.chat_session(system_prompt="""
You are an assistant that always replies in English.
Always format your responses using valid Markdown syntax so they can be parsed by marked.js.
- Use fenced code blocks with language identifiers for code 
```language
<code here>
- Use proper line breaks using \\n and double \\n for paragraph breaks.
- Use lists (- or 1.) for steps.
- Use headings (#, ##) when appropriate.
Do not output raw HTML tags like <code> or <p>.
"""
)
chat_session.__enter__()  # enter once, keep alive


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/stream", methods=["GET"])
def stream():
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
            for token in model.generate(
                prompt,
                max_tokens=max_tokens,   # use max_tokens here
                temp=temp,
                top_p=top_p,
                streaming=True
            ):
                token_count += 1
                print(f"TOKEN {token_count}: {repr(token)}", flush=True)
                buffer += token
                safe_token = base64.b64encode(token.encode()).decode()
                yield f"data: {safe_token}\n\n"

            # after streaming finishes, extract code blocks
            code_blocks = re.findall(r"```(\w+)?\n([\s\S]*?)```", buffer)
            if code_blocks:
                # make sure code/ folder exists
                os.makedirs("code", exist_ok=True)

                for idx, (lang, code) in enumerate(code_blocks, start=1):
                    language = (lang or "plain").lower()
                    code_text = code.strip()

                    # map language to file extension
                    ext_map = {
                        "python": "py",
                        "javascript": "js",
                        "java": "java",
                        "c": "c",
                        "cpp": "cpp",
                        "html": "html",
                        "css": "css",
                        "json": "json",
                        "bash": "sh",
                        "plain": "txt"
                    }
                    extension = ext_map.get(language, "txt")

                    # build filename
                    filename = f"code/{prompt[:20].replace(' ', '_')}_{idx}.{extension}"

                    # write to file
                    with open(filename, "w", encoding="utf-8") as f:
                        f.write(code_text)
                    # append to a JSON file 
                    with open("generated_code.json", "a", encoding="utf-8") as f: 
                        f.write(f'{{"filename": "{filename}", "language": "{language}", "code": """{code_text}"""}}\n')

                    print(f"Saved code block #{idx} to {filename}")


            # explicit end marker
            print(f"Total tokens generated: {token_count}")
            yield "data: [DONE]\n\n"

        except Exception as e:
            # send error downstream
            err_msg = f"[ERROR] {str(e)}"
            safe_err = base64.b64encode(err_msg.encode()).decode()
            yield f"data: {safe_err}\n\n"
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"  # disable proxy buffering
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
