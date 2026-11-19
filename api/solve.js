export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const image = request.body?.image;
  if (!image?.data || !image?.mimeType) {
    return response.status(400).json({ error: "An image is required" });
  }

  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(image.mimeType)) {
    return response.status(400).json({ error: "Unsupported image type" });
  }

  // Vercel request limits require a conservative file-size limit.
  if (image.data.length > 4.5 * 1024 * 1024) {
    return response.status(413).json({ error: "Image is too large" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return response.status(500).json({ error: "Gemini API is not configured" });
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

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
            text: "You are helping a student read and answer a biology essential-content worksheet. Read the image carefully. Identify every question or prompt and provide a complete, concise, well-organized answer."
          }]
        },
        contents: [{
          role: "user",
          parts: [
            { text: "Read this worksheet, identify every question or prompt, and provide concise answers." },
            { inlineData: { mimeType: image.mimeType, data: image.data } }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000
        }
      })
    });

    const data = await aiResponse.json().catch(() => null);

    if (!aiResponse.ok) {
      console.error("Gemini API returned an error", aiResponse.status);
      return response.status(502).json({ error: "Gemini could not process this image" });
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
