// background.js — Service Worker (Manifest V3)
// รับ message จาก content.js → เรียก OpenAI API → ส่งผลกลับ

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAnswer') {
    handleGetAnswer(request)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // บอก Chrome ว่าตอบแบบ async
  }
});

async function handleGetAnswer({ question, choices }) {
  const config = await chrome.storage.local.get(['apiKey', 'model']);
  const apiKey = config.apiKey;
  const model = config.model || 'gpt-4o-mini';

  if (!apiKey) {
    return { error: 'ยังไม่ได้ตั้งค่า API Key — กรุณาคลิก icon extension แล้วใส่ key' };
  }

  // สร้าง prompt กระชับ ประหยัด token ที่สุด
  const choicesText = choices.map(c => `${c.letter}. ${c.text}`).join('\n');
  const userMessage = `${question}\n${choicesText}`;

  const body = {
    model,
    messages: [
      {
        role: 'system',
        // กระชับ ไม่เปลือง token — AI ตอบแค่ตัวอักษรเดียว
        content: 'You are a Thai academic expert. Answer each multiple-choice question with ONLY one letter: a, b, c, d, or e. No explanation, no punctuation.'
      },
      {
        role: 'user',
        content: userMessage
      }
    ],
    max_tokens: 5,   // ตอบแค่ 1 ตัวอักษร ประหยัด token มาก
    temperature: 0   // deterministic — ได้คำตอบเดิมทุกครั้ง
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
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '';

  // แยกตัวอักษรแรกที่เป็น a-e (case-insensitive)
  const match = raw.match(/[a-eA-E]/);
  if (!match) {
    throw new Error(`AI ตอบ: "${raw}" — ไม่ใช่ตัวเลือกที่ถูกต้อง`);
  }

  return { answer: match[0].toLowerCase() };
}
