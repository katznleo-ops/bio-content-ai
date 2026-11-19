export default async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const image = body?.image;
  if (!image?.data || !image?.mimeType) {
    return Response.json({ error: "An image is required" }, { status: 400 });
  }

  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(image.mimeType)) {
    return Response.json({ error: "Unsupported image type" }, { status: 400 });
  }

  if (image.data.length > 14 * 1024 * 1024) {
    return Response.json({ error: "Image is too large" }, { status: 413 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Gemini API is not configured" }, { status: 500 });
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
          parts: [
            {
              text: "You are helping a student read and answer a biology essential-content worksheet. Read the image carefully. Return a complete, well-organized answer in the worksheet's expected format. If a blank cannot be read, say that it is unclear. Do not invent text."
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Read this worksheet, identify every question or prompt, and provide concise answers."
              },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000
        }
      })
    });

    const data = await aiResponse.json().catch(() => null);

    if (!aiResponse.ok) {
      console.error("Gemini API returned an error", aiResponse.status);
      return Response.json({ error: "Gemini could not process this image" }, { status: 502 });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      return Response.json({ error: "Gemini returned no answer" }, { status: 502 });
    }

    return Response.json({ answer });
  } catch (error) {
    console.error("Gemini API request failed", error);
    return Response.json({ error: "Unable to contact Gemini" }, { status: 502 });
  }
};
