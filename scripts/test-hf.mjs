import keytar from "keytar";

const key = await keytar.getPassword("grudge-dev-tool", "ai.huggingface");
if (!key) {
  console.error("No HF token in vault");
  process.exit(1);
}

const model = "Qwen/Qwen2.5-Coder-7B-Instruct";
const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    max_tokens: 8,
    stream: false,
  }),
});

const text = await res.text();
console.log("status:", res.status);
console.log("body:", text.slice(0, 400));