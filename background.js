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
  const config    = await chrome.storage.local.get(['apiKey', 'model', 'webSearch']);
  const apiKey    = config.apiKey;
  const rawModel  = config.model || 'gpt-4o';
  const webSearch = config.webSearch || false;

  if (!apiKey) {
    return { error: 'ยังไม่ได้ตั้งค่า API Key — คลิก icon extension แล้วใส่ key' };
  }

  // ตรวจว่าเป็น Thai Law Expert mode
  const isLawModel = rawModel.startsWith('law:');
  const model      = isLawModel ? rawModel.replace('law:', '') : rawModel;

  // ถ้าเปิด Web Search หรือเลือก model ที่เป็น search-preview หรือ gpt-5 → ใช้ Responses API
  const isSearchModel = /search-preview/.test(model);
  const isGPT5       = /^gpt-5/.test(model);
  if (webSearch || isSearchModel || isGPT5) {
    return handleGetAnswerWithSearch({ question, choices, apiKey, model, isLawModel });
  }

  const question_s      = sanitizeText(question, 4000);
  const choicesText     = choices.map(c => `${c.letter}) ${sanitizeText(c.text, 800)}`).join('\n');
  const isEnglish       = detectEnglish(question_s);
  const isReasoningModel = /^o[0-9]/.test(model);
  const lastLetter      = choices.length > 0 ? choices[choices.length - 1].letter : 'e';
  const letterList      = choices.length > 0 ? choices.map(c => c.letter).join(', ') : 'a, b, c, d, e';

  // ===== JSON mode (GPT-4o / GPT-3.5 / GPT-4) =====
  // บังคับให้ตอบ {"answer":"b"} เท่านั้น — ไม่มีทางตอบผิดรูปแบบ
  const lawExpertPrompt = `คุณคือผู้เชี่ยวชาญกฎหมายไทยอาวุโส มีความรู้ลึกซึ้งในกฎหมายไทยทุกสาขา ได้แก่:
- ประมวลกฎหมายอาญา (ป.อ.) และกฎหมายวิธีพิจารณาความอาญา (ป.วิ.อ.)
- ประมวลกฎหมายแพ่งและพาณิชย์ (ป.พ.พ.) และกฎหมายวิธีพิจารณาความแพ่ง (ป.วิ.พ.)
- รัฐธรรมนูญแห่งราชอาณาจักรไทย ทุกฉบับ
- กฎหมายปกครอง พ.ร.บ.วิธีปฏิบัติราชการทางปกครอง และกฎหมายจัดตั้งศาลปกครอง
- กฎหมายแรงงาน กฎหมายภาษีอากร ทรัพย์สินทางปัญญา และกฎหมายธุรกิจ
- คำพิพากษาฎีกาและบรรทัดฐานศาลสูงที่สำคัญ
วิเคราะห์โจทย์ด้วยหลักกฎหมาย บรรทัดฐานของศาล และหลักนิติศาสตร์อย่างเป็นระบบ
โจทย์นี้มีตัวเลือก ${letterList} — ตอบด้วย JSON รูปแบบนี้เท่านั้น: {"answer":"x"} โดย x คือตัวอักษรของตัวเลือกที่ถูกที่สุด ห้ามมีข้อความอื่น`;

  const systemPrompt = isEnglish
    ? `You are a multiple-choice exam expert. The choices are ${letterList}. Respond ONLY with valid JSON in this exact format: {"answer":"x"} where x is the single best choice letter. No explanation, no other text.`
    : isLawModel
      ? lawExpertPrompt
      : `คุณคือผู้เชี่ยวชาญกฎหมายไทยและวิชาการระดับมหาวิทยาลัย เชี่ยวชาญ: กฎหมายอาญา แพ่ง รัฐธรรมนูญ ปกครอง
โจทย์นี้มีตัวเลือก ${letterList} — ตอบด้วย JSON รูปแบบนี้เท่านั้น: {"answer":"x"} โดย x คือตัวอักษรของตัวเลือกที่ถูกที่สุด ห้ามมีข้อความอื่น`;

  const userPrompt = isEnglish
    ? `Question: ${question_s}\n\nChoices:\n${choicesText}`
    : `โจทย์: ${question_s}\n\nตัวเลือก:\n${choicesText}`;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ],
    ...(isReasoningModel
      ? { max_completion_tokens: 100 }
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
    if (/^[a-z]$/.test(letter)) {
      return { answer: letter };
    }
  } catch (_) { /* ไม่ใช่ JSON ใช้ fallback */ }

  // วิธีที่ 2: regex fallback สำหรับ o-series หรือ model ที่ไม่รองรับ json_object
  const answerMatch =
    raw.match(/["\s:]([a-zA-Z])["\s,}]/) ||  // {"answer":"b"} หรือ : b
    raw.match(/ANSWER\s*[：:]\s*([a-zA-Z])/i) ||
    raw.match(/ตอบ\s*[：:]\s*([a-zA-Z])/i) ||
    raw.match(/คำตอบ\s*[：:]\s*([a-zA-Z])/i) ||
    raw.match(/^([a-zA-Z])$/m) ||             // บรรทัดที่มีแค่ตัวอักษรเดียว
    raw.match(/^([a-zA-Z])\b/m);              // ขึ้นต้นบรรทัดด้วยตัวอักษร

  if (answerMatch) {
    return { answer: answerMatch[1].toLowerCase() };
  }

  throw new Error(`วิเคราะห์คำตอบไม่ได้: "${raw.slice(0, 60)}"`);
}

// ===================================================================
// Web Search — ใช้ OpenAI Responses API + web_search_preview tool
// AI จะค้นหาข้อมูลจากเว็บก่อน แล้วนำมาวิเคราะห์คำตอบ
// ===================================================================
async function handleGetAnswerWithSearch({ question, choices, apiKey, model, isLawModel = false }) {
  const question_s  = sanitizeText(question, 4000);
  const choicesText = choices.map(c => `${c.letter}) ${sanitizeText(c.text, 800)}`).join('\n');
  const isEnglish   = detectEnglish(question_s);
  const lastLetter  = choices.length > 0 ? choices[choices.length - 1].letter : 'e';
  const letterList  = choices.length > 0 ? choices.map(c => c.letter).join(', ') : 'a, b, c, d, e';

  // Responses API รองรับ web_search_preview tool กับ model ปกติ
  // ไม่ต้องใช้ชื่อ -search-preview อีกต่อไป (deprecated)
  const isOSeries   = /^o[0-9]/.test(model);
  const isMiniBased = /mini/.test(model);
  const searchModel = isOSeries
    ? 'gpt-4o'           // o-series ไม่รองรับ web search → fallback gpt-4o
    : /search-preview/.test(model)
      ? model.replace(/-search-preview$/, '')  // แปลง legacy model name → ปกติ
      : model;                                  // gpt-5, gpt-4o, gpt-4o-mini → ใช้ตรงๆ

  const lawSearchPrompt = `คุณคือผู้เชี่ยวชาญกฎหมายไทยอาวุโสระดับสูงสุด มีความเชี่ยวชาญลึกซึ้งในกฎหมายไทยทุกสาขา:
- ประมวลกฎหมายอาญา (ป.อ.) และกฎหมายวิธีพิจารณาความอาญา (ป.วิ.อ.) ทุกมาตรา
- ประมวลกฎหมายแพ่งและพาณิชย์ (ป.พ.พ.) และกฎหมายวิธีพิจารณาความแพ่ง (ป.วิ.พ.) ทุกมาตรา
- รัฐธรรมนูญแห่งราชอาณาจักรไทย ทุกฉบับ และหลักรัฐธรรมนูญนิยม
- กฎหมายปกครอง พ.ร.บ.วิธีปฏิบัติราชการทางปกครอง กฎหมายจัดตั้งศาลปกครอง
- กฎหมายแรงงาน กฎหมายภาษีอากร ทรัพย์สินทางปัญญา กฎหมายธุรกิจ และกฎหมายระหว่างประเทศ
- คำพิพากษาศาลฎีกา คำวินิจฉัยศาลรัฐธรรมนูญ และคำพิพากษาศาลปกครองสูงสุด
ขั้นตอน:
1. ค้นหาข้อมูลจากเว็บ: บทบัญญัติกฎหมาย คำพิพากษาฎีกา ตำราและเอกสารวิชาการ
2. วิเคราะห์หลักกฎหมายและเปรียบเทียบตัวเลือกทั้งหมดอย่างละเอียด
3. สรุปตัวเลือกที่ถูกต้องที่สุดตามหลักกฎหมายไทย
โจทย์นี้มีตัวเลือก ${letterList} — ตอบด้วย JSON รูปแบบนี้เท่านั้น: {"answer":"x"} โดย x คือตัวอักษรของตัวเลือกที่ถูกที่สุด ห้ามมีข้อความอื่น`;

  const systemPrompt = isEnglish
    ? `You are a multiple-choice exam expert. The choices are ${letterList}. Use web search to find relevant and accurate information, then analyze and select the single best answer. Respond ONLY with valid JSON: {"answer":"x"} where x is the correct choice letter. No explanation, no other text.`
    : isLawModel
      ? lawSearchPrompt
      : `คุณคือผู้เชี่ยวชาญกฎหมายไทยและวิชาการ ค้นหาข้อมูลจากเว็บเกี่ยวกับโจทย์นี้ให้ครบถ้วน แล้ววิเคราะห์เพื่อหาคำตอบที่ถูกต้องที่สุด
โจทย์นี้มีตัวเลือก ${letterList} — ตอบด้วย JSON รูปแบบนี้เท่านั้น: {"answer":"x"} โดย x คือตัวอักษรของตัวเลือกที่ถูกที่สุด ห้ามมีข้อความอื่น`;

  const userPrompt = isEnglish
    ? `Question: ${question_s}\n\nChoices:\n${choicesText}`
    : `โจทย์: ${question_s}\n\nตัวเลือก:\n${choicesText}`;

  const body = {
    model: searchModel,
    tools: [{ type: 'web_search_preview' }],
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
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

  // หา message output จาก Responses API
  const messageOutput = (data.output || []).find(o => o.type === 'message');
  const raw = (messageOutput?.content || []).find(c => c.type === 'output_text')?.text?.trim() || '';

  console.log('[QuizAA background] web-search raw:', raw);

  // Parse JSON
  try {
    const parsed = JSON.parse(raw);
    const letter = (parsed.answer || parsed.Answer || parsed.ANSWER || '').toString().trim().toLowerCase();
    if (/^[a-z]$/.test(letter)) return { answer: letter };
  } catch (_) { /* fallback ด้านล่าง */ }

  // Regex fallback
  const answerMatch =
    raw.match(/["\s:]([a-zA-Z])["\s,}]/) ||
    raw.match(/ANSWER\s*[：:]\s*([a-zA-Z])/i) ||
    raw.match(/ตอบ\s*[：:]\s*([a-zA-Z])/i) ||
    raw.match(/คำตอบ\s*[：:]\s*([a-zA-Z])/i) ||
    raw.match(/^([a-zA-Z])$/m) ||
    raw.match(/^([a-zA-Z])\b/m);

  if (answerMatch) return { answer: answerMatch[1].toLowerCase() };

  throw new Error(`วิเคราะห์คำตอบไม่ได้ (web search): "${raw.slice(0, 60)}"`);
}

// ตรวจจับว่าโจทย์เป็นภาษาอังกฤษหรือไทย
// นับอักขระ ASCII ตัวอักษร vs ภาษาไทย (Unicode \u0E00-\u0E7F)
function detectEnglish(text) {
  const thaiChars    = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  // ถ้ามีตัวไทยน้อยกว่า 10% ของ english chars = ถือว่าเป็น English
  return thaiChars < englishChars * 0.1;
}

// normalize whitespace + ตัดข้อความที่ยาวเกิน maxChars ออก
// ป้องกัน token overflow เมื่อโจทย์หรือตัวเลือกมีข้อความยาวมาก
function sanitizeText(text, maxChars) {
  const cleaned = text
    .replace(/[\t ]+/g, ' ')             // collapse spaces/tabs
    .replace(/(\r?\n|\r){3,}/g, '\n\n')  // max 2 newlines ติดกัน
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars) + '…';
}

