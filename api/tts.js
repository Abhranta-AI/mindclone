// Text-to-Speech API - ElevenLabs proxy endpoint
// Converts AI response text to audio using ElevenLabs TTS

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, voiceId } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Check for ElevenLabs API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'ElevenLabs API key not configured',
        message: 'Please add ELEVENLABS_API_KEY to your environment variables'
      });
    }

    // Use provided voiceId or fall back to environment default
    const selectedVoiceId = voiceId || process.env.ELEVENLABS_VOICE_ID;
    if (!selectedVoiceId) {
      return res.status(400).json({
        error: 'Voice ID is required',
        message: 'Please provide voiceId or set ELEVENLABS_VOICE_ID environment variable'
      });
    }

    // Truncate text if too long (ElevenLabs has limits)
    const maxChars = 5000;
    const truncatedText = text.length > maxChars ? text.substring(0, maxChars) + '...' : text;

    console.log(`[TTS] Generating audio for ${truncatedText.length} chars with voice ${selectedVoiceId}`);

    // Call ElevenLabs text-to-speech API
    const elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        body: JSON.stringify({
          text: truncatedText,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text();
      console.error('[TTS] ElevenLabs error:', elevenLabsResponse.status, errorText);

      // Handle specific error cases
      if (elevenLabsResponse.status === 401) {
        return res.status(401).json({ error: 'Invalid ElevenLabs API key' });
      }
      if (elevenLabsResponse.status === 422) {
        return res.status(422).json({ error: 'Invalid voice ID or request parameters' });
      }
      if (elevenLabsResponse.status === 429) {
        return res.status(429).json({ error: 'ElevenLabs rate limit exceeded. Try again later.' });
      }

      return res.status(elevenLabsResponse.status).json({
        error: 'ElevenLabs API error',
        details: errorText
      });
    }

    // Stream the audio response back
    const audioBuffer = await elevenLabsResponse.arrayBuffer();

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.setHeader('Cache-Control', 'no-cache');

    console.log(`[TTS] Successfully generated ${audioBuffer.byteLength} bytes of audio`);

    return res.send(Buffer.from(audioBuffer));

  } catch (error) {
    console.error('[TTS] Error:', error);
    return res.status(500).json({
      error: 'Failed to generate speech',
      message: error.message
    });
  }
};
