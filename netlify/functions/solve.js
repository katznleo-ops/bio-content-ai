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

  const baseUrl = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!baseUrl || !apiKey) {
    return Response.json({
      error: "Netlify AI Gateway is not configured"
    }, { status: 500 });
  }

  const model = process.env.AI_GATEWAY_MODEL || "gpt-5-mini";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  try {
    const aiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: "You are helping a student read and answer a biology essential-content worksheet. Read the image carefully. Return a complete, well-organized answer in the worksheet's expected format. If a blank cannot be read, say that it is unclear. Do not invent text."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this worksheet, identify every question or prompt, and provide concise answers."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${image.mimeType};base64,${image.data}`
                }
              }
            ]
          }
        ]
      })
    });

    const data = await aiResponse.json().catch(() => null);

    if (!aiResponse.ok) {
      const gatewayMessage = data?.error?.message || data?.message || "AI request failed";
      return Response.json({ error: gatewayMessage }, { status: 502 });
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      return Response.json({ error: "The AI returned no answer" }, { status: 502 });
    }

    return Response.json({ answer });
  } catch (error) {
    console.error("AI Gateway request failed", error);
    return Response.json({ error: "Unable to contact the AI service" }, { status: 502 });
  }
};
