// background.js — Service Worker (Manifest V3)
// รับ message จาก content.js → เรียก OpenAI API → ส่งผลกลับ

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAnswer') {
    handleGetAnswer(request)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // async response
  }
});

async function handleGetAnswer({ question, choices }) {
  const config = await chrome.storage.local.get(['apiKey', 'model']);
  const apiKey = config.apiKey;
  const model  = config.model || 'gpt-4o';

  if (!apiKey) {
    return { error: 'ยังไม่ได้ตั้งค่า API Key — คลิก icon extension แล้วใส่ key' };
  }

  const choicesText = choices.map(c => `${c.letter}) ${c.text}`).join('\n');
  const isEnglish       = detectEnglish(question);
  const isReasoningModel = /^o[0-9]/.test(model);

  // ===== JSON mode (GPT-4o / GPT-3.5 / GPT-4) =====
  // บังคับให้ตอบ {"answer":"b"} เท่านั้น — ไม่มีทางตอบผิดรูปแบบ
  const systemPrompt = isEnglish
    ? `You are a multiple-choice exam expert. Respond ONLY with valid JSON in this exact format: {"answer":"x"} where x is the single best choice letter (a, b, c, d, or e). No explanation, no other text.`
    : `คุณคือผู้เชี่ยวชาญกฎหมายไทยและวิชาการระดับมหาวิทยาลัย เชี่ยวชาญ: กฎหมายอาญา แพ่ง รัฐธรรมนูญ ปกครอง
ตอบด้วย JSON รูปแบบนี้เท่านั้น: {"answer":"x"} โดย x คือตัวอักษรของคำตอบที่ถูกที่สุด (a, b, c, d หรือ e) ห้ามมีข้อความอื่น`;

  const userPrompt = isEnglish
    ? `Question: ${question}\n\nChoices:\n${choicesText}`
    : `โจทย์: ${question}\n\nตัวเลือก:\n${choicesText}`;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ],
    ...(isReasoningModel
      ? { max_completion_tokens: 50 }
      : {
          max_tokens: 20,
          temperature: 0,
          response_format: { type: 'json_object' }  // บังคับ JSON — ไม่มีทางตอบผิดรูปแบบ
        }
    )
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw  = (data.choices?.[0]?.message?.content ?? '').trim();

  console.log('[QuizAA background] raw response:', raw);

  // วิธีที่ 1: JSON mode → {"answer":"b"}
  try {
    const parsed = JSON.parse(raw);
    const letter = (parsed.answer || parsed.Answer || parsed.ANSWER || '').toString().trim().toLowerCase();
    if (/^[a-e]$/.test(letter)) {
      return { answer: letter };
    }
  } catch (_) { /* ไม่ใช่ JSON ใช้ fallback */ }

  // วิธีที่ 2: regex fallback สำหรับ o-series หรือ model ที่ไม่รองรับ json_object
  const answerMatch =
    raw.match(/["\s:]([a-eA-E])["\s,}]/) ||  // {"answer":"b"} หรือ : b
    raw.match(/ANSWER\s*[：:]\s*([a-eA-E])/i) ||
    raw.match(/ตอบ\s*[：:]\s*([a-eA-E])/i) ||
    raw.match(/คำตอบ\s*[：:]\s*([a-eA-E])/i) ||
    raw.match(/^([a-eA-E])$/m) ||             // บรรทัดที่มีแค่ตัวอักษรเดียว
    raw.match(/^([a-eA-E])\b/m);              // ขึ้นต้นบรรทัดด้วยตัวอักษร

  if (answerMatch) {
    return { answer: answerMatch[1].toLowerCase() };
  }

  throw new Error(`วิเคราะห์คำตอบไม่ได้: "${raw.slice(0, 60)}"`);
}

// ตรวจจับว่าโจทย์เป็นภาษาอังกฤษหรือไทย
// นับอักขระ ASCII ตัวอักษร vs ภาษาไทย (Unicode \u0E00-\u0E7F)
function detectEnglish(text) {
  const thaiChars    = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  // ถ้ามีตัวไทยน้อยกว่า 10% ของ english chars = ถือว่าเป็น English
  return thaiChars < englishChars * 0.1;
}

