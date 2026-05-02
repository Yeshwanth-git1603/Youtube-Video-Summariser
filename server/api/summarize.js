const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Fetches YouTube transcript directly using YouTube's internal API.
 * More reliable than libraries on cloud/serverless platforms.
 */
async function fetchTranscript(videoId) {
  // Step 1: Fetch the YouTube video page to get caption track info
  const videoPageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResponse = await fetch(videoPageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });

  if (!pageResponse.ok) {
    throw new Error('Failed to fetch YouTube video page');
  }

  const pageHtml = await pageResponse.text();

  // Step 2: Extract captions player response JSON
  const captionMatch = pageHtml.match(/"captions":\s*(\{.*?"captionTracks":\s*\[.*?\].*?\})/s);
  if (!captionMatch) {
    throw new Error('No captions found for this video');
  }

  // Extract the captionTracks array
  const tracksMatch = pageHtml.match(/"captionTracks":\s*(\[.*?\])/s);
  if (!tracksMatch) {
    throw new Error('No caption tracks found');
  }

  let captionTracks;
  try {
    captionTracks = JSON.parse(tracksMatch[1]);
  } catch (e) {
    throw new Error('Failed to parse caption tracks');
  }

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No caption tracks available');
  }

  // Step 3: Pick the best caption track (prefer manual captions, then auto-generated)
  let selectedTrack = captionTracks.find(t => t.kind !== 'asr') || captionTracks[0];
  let captionUrl = selectedTrack.baseUrl;

  // Step 4: Fetch the actual transcript XML
  const captionResponse = await fetch(captionUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });

  if (!captionResponse.ok) {
    throw new Error('Failed to fetch caption data');
  }

  const captionXml = await captionResponse.text();

  // Step 5: Parse the XML to extract text
  const textSegments = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(captionXml)) !== null) {
    // Decode HTML entities
    let text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();
    if (text) {
      textSegments.push(text);
    }
  }

  if (textSegments.length === 0) {
    throw new Error('Transcript is empty');
  }

  return textSegments.join(' ');
}

module.exports = async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { videoId, title, channel } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  try {
    // 1. Fetch transcript using our custom fetcher
    let fullTranscript;
    try {
      fullTranscript = await fetchTranscript(videoId);
    } catch (e) {
      console.error('Transcript fetch error:', e.message);
      return res.status(404).json({ error: 'No transcript available for this video, or captions are disabled.' });
    }

    // 2. Prepare OpenAI prompt
    const systemPrompt = `
      You are an expert multilingual video summarizer. The transcript provided may be in ANY language (Hindi, Tamil, Telugu, Spanish, French, Korean, Japanese, etc.).
      Regardless of the language of the transcript, you MUST always write your entire response in ENGLISH.
      Understand the content fully, then provide a summary in the exact JSON format below. Ensure the JSON is valid and parsable. Do not use markdown wrapping around the JSON.

      IMPORTANT — SPEAKER & GUEST IDENTIFICATION:
      You will also receive the video title and channel name as context. Use these along with the transcript to identify:
      1. "speaker_info" — The host, presenter, or main speaker of the video (often the channel owner). Include their name and a brief note about who they are and what they do. If you cannot identify them, set to null.
      2. "guest_info" — Any guests, interviewees, or featured persons in the video. Include their name(s) and a brief note about who they are and what they do. If there are multiple guests, mention all of them. If there is no guest (e.g., solo video), set to null.

      Rules for names:
      - If names appear in a non-Latin script (Hindi, Tamil, Korean, etc.), transliterate them into English.
      - Always return these as simple English strings, never as objects or arrays.

      {
        "speaker_info": "Name of the host/speaker and who they are, or null",
        "guest_info": "Name(s) of the guest(s) and who they are, or null",
        "tldr": "short summary in English",
        "detailed_summary": "long explanation in English",
        "key_points": ["point 1 in English", "point 2 in English"],
        "insights": ["insight 1 in English", "insight 2 in English"],
        "suggestions": ["suggestion 1 in English", "suggestion 2 in English"]
      }
    `;

    const maxChars = 80000;
    const safeTranscript = fullTranscript.length > maxChars
      ? fullTranscript.substring(0, maxChars) + "... [Transcript truncated due to length]"
      : fullTranscript;

    const userMessage = `Video Title: ${title || 'Unknown'}\nChannel: ${channel || 'Unknown'}\n\nTranscript:\n${safeTranscript}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: "json_object" }
    });

    const output = JSON.parse(response.choices[0].message.content);
    res.json(output);

  } catch (error) {
    console.error('Error summarising video:', error);
    res.status(500).json({ error: error.message || 'Failed to process video' });
  }
};
