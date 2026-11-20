const allowedOrigin = "https://katznleo-ops.github.io";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const prompt = typeof request.body?.prompt === "string"
    ? request.body.prompt.trim()
    : "";

  if (!prompt) {
    return response.status(400).json({ error: "Please enter a question" });
  }

  if (prompt.length > 8000) {
    return response.status(413).json({ error: "Question must be 8,000 characters or fewer" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return response.status(500).json({ error: "Gemini API is not configured" });
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

  try {
    const aiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are a helpful biology tutor. Answer the student's question accurately and clearly. Explain concepts in student-friendly language."
          }]
        },
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000
        }
      })
    });

    const data = await aiResponse.json().catch(() => null);

    if (!aiResponse.ok) {
      console.error("Gemini API returned an error", {
        status: aiResponse.status,
        model,
        details: data?.error?.message || "No error details returned"
      });
      return response.status(502).json({
        error: "Gemini could not answer this question"
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      return response.status(502).json({ error: "Gemini returned no answer" });
    }

    return response.status(200).json({ answer });
  } catch (error) {
    console.error("Gemini API request failed", error);
    return response.status(502).json({ error: "Unable to contact Gemini" });
  }
}
