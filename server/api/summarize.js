const { YoutubeTranscript } = require('youtube-transcript');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    // 1. Fetch transcript — try any available language
    let transcriptItems;
    try {
      transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (e1) {
      const fallbackLangs = ['en', 'hi', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'zh', 'ar', 'ru', 'ta', 'te', 'kn', 'ml'];
      let fetched = false;
      for (const lang of fallbackLangs) {
        try {
          transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang });
          fetched = true;
          break;
        } catch (_) { /* try next language */ }
      }
      if (!fetched) {
        return res.status(404).json({ error: 'No transcript available for this video in any language, or captions are disabled.' });
      }
    }

    const fullTranscript = transcriptItems.map(item => item.text).join(' ');

    if (!fullTranscript) {
      return res.status(404).json({ error: 'Transcript is empty.' });
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
