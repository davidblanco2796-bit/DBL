import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(express.json({ limit: "15mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

function parseImageDataUrl(image) {
  if (typeof image !== "string") return null;
  const match = image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if (!match) return null;
  const [, mediaType, data] = match;
  return { mediaType, data };
}

const SUGGEST_TOOL = {
  name: "record_duct_suggestions",
  description:
    "Record suggested pin locations for ductwork risers, trunk lines, and branch lines visible in the drawing image.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: ["riser", "trunk", "branch"] },
            xPct: { type: "number", description: "Horizontal position, 0-100, percent of image width from the left edge." },
            yPct: { type: "number", description: "Vertical position, 0-100, percent of image height from the top edge." },
            note: { type: "string", description: "Short label if visible nearby, e.g. duct size or run tag." },
          },
          required: ["category", "xPct", "yPct"],
        },
      },
    },
    required: ["suggestions"],
  },
};

const SCAN_PROMPT = `This is one page of an HVAC/mechanical plan drawing. Identify visible duct
main trunk lines, branch duct lines, and riser symbols (round duct risers,
vertical shaft indicators, riser tags/callouts). For each one you can
actually see, record its approximate location as a percentage of image
width/height. Be conservative — only report items you can identify with
reasonable confidence, prefer fewer high-confidence suggestions over many
guesses, and do not invent items that aren't in the drawing.`;

app.post("/api/scan", async (req, res) => {
  try {
    const parsed = parseImageDataUrl(req.body?.image);
    if (!parsed) {
      return res.status(400).json({ error: "Missing or unparseable image (expected a data URL string)." });
    }
    const { mediaType, data: base64Data } = parsed;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: "record_duct_suggestions" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: SCAN_PROMPT },
          ],
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    const suggestions = Array.isArray(toolUse?.input?.suggestions) ? toolUse.input.suggestions : [];
    res.json({ suggestions });
  } catch (err) {
    console.error("scan error:", err);
    res.status(500).json({ error: "Scan failed. Check server logs and ANTHROPIC_API_KEY." });
  }
});

const CHAT_SYSTEM_PROMPT = `You are helping an HVAC/mechanical estimator read an Aeroseal duct-sealing
job plan drawing. You'll see the currently-open page of the plan set as an
image with each message, plus the estimator's question. Answer questions
about what's visible: riser counts, trunk/branch duct runs, duct sizes,
pressure class notes, tags/callouts, access notes, etc. Be concise. If
something isn't visible or legible in the image, say so plainly rather than
guessing — this feeds into a real bid.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body || {};
    const parsed = parseImageDataUrl(req.body?.image);
    if (!parsed) {
      return res.status(400).json({ error: "Missing or unparseable image (expected a data URL string)." });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing messages." });
    }
    const { mediaType, data: base64Data } = parsed;

    const anthropicMessages = messages.map((m, i) => {
      const isLastUserTurn = i === messages.length - 1 && m.role === "user";
      if (isLastUserTurn) {
        return {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: String(m.content || "") },
          ],
        };
      }
      return { role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") };
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: CHAT_SYSTEM_PROMPT,
      messages: anthropicMessages,
    });

    const textBlock = response.content.find((block) => block.type === "text");
    res.json({ reply: textBlock?.text || "" });
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({ error: "Chat failed. Check server logs and ANTHROPIC_API_KEY." });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`AI scan server listening on :${port}`));
