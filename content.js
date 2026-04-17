;(function () {
  'use strict';

  let busy = false;

  document.addEventListener('dblclick', function (e) {
    if (busy) return;

    // ห้าม trigger ถ้าคลิกบน radio/checkbox/ปุ่มโดยตรง
    if (e.target.matches('input, button, a, select, textarea')) return;

    // หา container ข้อสอบ
    const queEl = findQuestionContainer(e.target);
    if (!queEl) return;

    e.preventDefault();

    const questionText = extractQuestionText(queEl);
    if (!questionText || questionText.length < 3) return;

    const choices = extractChoices(queEl);
    if (choices.length === 0) return;

    busy = true;
    setDot(queEl, 'loading');

    console.info('[QuizAA] โจทย์:', questionText);
    console.info('[QuizAA] ตัวเลือก:', choices.map(c => `${c.letter}. ${c.text}`));

    chrome.runtime.sendMessage(
      {
        action: 'getAnswer',
        question: questionText,
        choices: choices.map(c => ({ letter: c.letter, text: c.text }))
      },
      function (response) {
        busy = false;

        if (chrome.runtime.lastError || !response) {
          setDot(queEl, 'error');
          console.warn('[QuizAA] runtime error:', chrome.runtime.lastError?.message);
          return;
        }
        if (response.error) {
          setDot(queEl, 'error');
          console.warn('[QuizAA] API error:', response.error);
          return;
        }
        if (response.answer) {
          const idx = response.answer.charCodeAt(0) - 97; // 'a'=0, 'b'=1 ...
          if (choices[idx]) {
            selectChoice(choices[idx]);
            setDot(queEl, 'done');
            console.info('[QuizAA] ✓ ตอบ:', response.answer.toUpperCase(), '→', choices[idx].text);
          } else {
            setDot(queEl, 'error');
            console.warn('[QuizAA] ไม่พบ index:', idx, '/ มีทั้งหมด:', choices.length);
          }
        }
      }
    );
  });

  // ===================================================================
  // หา container ข้อสอบ
  // ===================================================================
  function findQuestionContainer(target) {
    // Moodle ทุกเวอร์ชัน: .que
    const que = target.closest('.que');
    if (que) return que;

    // Moodle บางธีมไม่มี .que ใช้ .formulation แทน
    const formulation = target.closest('.formulation');
    if (formulation) return formulation;

    // Google Forms
    const gform =
      target.closest('.freebirdFormviewerViewItemsItemItem') ||
      target.closest('[data-params]') ||
      target.closest('[jsmodel]');
    if (gform) return gform;

    // Generic — เดินขึ้น DOM หา container ที่มี radio อยู่ข้างใน
    let el = target;
    for (let i = 0; i < 10; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      const radios = el.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (radios.length >= 2) return el; // ต้องมีอย่างน้อย 2 ตัวเลือก
    }
    return null;
  }

  // ===================================================================
  // ดึงข้อความโจทย์ — ตัด instruction text ออก
  // ===================================================================
  function extractQuestionText(queEl) {
    // Moodle standard
    const qtext = queEl.querySelector('.qtext');
    if (qtext) return cleanQuestionText(qtext.innerText);

    // Moodle บางธีม: .formulation มี .qtext อยู่ข้างใน
    const formClone = queEl.querySelector('.formulation')?.cloneNode(true);
    if (formClone) {
      formClone.querySelectorAll('.answer, .ablock, .im-controls').forEach(n => n.remove());
      const t = cleanQuestionText(formClone.innerText);
      if (t.length > 5) return t;
    }

    // Generic — หา text block ที่ไม่มี input
    for (const el of queEl.querySelectorAll('p, h3, h4, [class*="stem"], [class*="question-text"]')) {
      if (el.querySelector('input, select')) continue;
      const t = cleanQuestionText(el.innerText);
      if (t.length > 5) return t;
    }

    // Last resort
    const clone = queEl.cloneNode(true);
    clone.querySelectorAll('input, label, .answer, [class*="option"], [class*="choice"]').forEach(n => n.remove());
    const t = cleanQuestionText(clone.innerText);
    return t.length > 5 ? t : null;
  }

  // ลบ instruction เช่น "Select one:", "เลือกหนึ่งข้อ:", บรรทัดว่าง
  function cleanQuestionText(raw) {
    return raw
      .replace(/select\s+one\s*:/gi, '')
      .replace(/เลือก(หนึ่ง|one)?\s*ข้อ\s*:/gi, '')
      .replace(/choose\s+(one|the\s+best)\s*:/gi, '')
      .replace(/^\s*[\r\n]+/gm, '')   // ลบบรรทัดว่าง
      .trim();
  }

  // ===================================================================
  // ดึงตัวเลือก — รองรับ a/b/c และ 1/2/3 และ ก/ข/ค
  // ===================================================================
  function extractChoices(queEl) {
    let choices = [];

    // วิธี 1: Moodle .answer > div (standard)
    const moodleDivs = queEl.querySelectorAll('.answer > div');
    if (moodleDivs.length >= 2) {
      moodleDivs.forEach((div, idx) => {
        const radio = div.querySelector('input[type="radio"], input[type="checkbox"]');
        const label = div.querySelector('label');
        if (radio && label) {
          choices.push({ letter: letter(idx), text: cleanChoiceText(label), radio, type: 'moodle' });
        }
      });
    }

    // วิธี 2: Moodle .answer inline radio (ไม่มี wrapper div)
    if (choices.length < 2) {
      choices = [];
      const answerEl = queEl.querySelector('.answer');
      if (answerEl) {
        answerEl.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((radio, idx) => {
          const label =
            queEl.querySelector(`label[for="${radio.id}"]`) ||
            radio.closest('label') ||
            radio.nextElementSibling;
          if (label) {
            choices.push({ letter: letter(idx), text: cleanChoiceText(label), radio, type: 'moodle-inline' });
          }
        });
      }
    }

    // วิธี 3: Google Forms
    if (choices.length < 2) {
      choices = [];
      queEl.querySelectorAll('[role="radio"], [role="checkbox"]').forEach((el, idx) => {
        const text =
          el.getAttribute('aria-label') ||
          el.querySelector('[class*="label"], [class*="text"]')?.innerText ||
          el.innerText.trim();
        if (text && text.length > 0) {
          choices.push({ letter: letter(idx), text: text.trim(), radio: el, type: 'gform' });
        }
      });
    }

    // วิธี 4: Generic — หา radio ทุกตัวในก้อน
    if (choices.length < 2) {
      choices = [];
      queEl.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((radio, idx) => {
        const label =
          document.querySelector(`label[for="${radio.id}"]`) ||
          radio.closest('label') ||
          radio.nextElementSibling;
        const rawText = label
          ? (label.innerText || label.textContent || '').trim()
          : radio.value || `ตัวเลือก ${idx + 1}`;
        const text = stripChoicePrefix(rawText);
        if (text) {
          choices.push({ letter: letter(idx), text, radio, type: 'generic' });
        }
      });
    }

    return choices;
  }

  // ===================================================================
  // ทำความสะอาด label ของตัวเลือก
  // ===================================================================
  function cleanChoiceText(labelEl) {
    const clone = labelEl.cloneNode(true);
    // ลบ .answernumber span ที่ Moodle ใส่ไว้ (เช่น "a.", "1.")
    clone.querySelectorAll('.answernumber, .answer-number, .num').forEach(n => n.remove());
    return stripChoicePrefix(clone.innerText.trim());
  }

  // ลบ prefix ตัวเลือกที่ฝังในข้อความ: "1. ", "a. ", "A) ", "ก. ", "ข. "
  function stripChoicePrefix(text) {
    return text
      .replace(/^[0-9]+[.)]\s*/, '')           // "1. " / "1) "
      .replace(/^[a-eA-E][.)]\s*/, '')          // "a. " / "A) "
      .replace(/^[ก-ฮ][.)]\s*/, '')            // "ก. " / "ข) "
      .replace(/^[ivxIVX]+[.)]\s*/i, '')        // Roman numerals
      .trim();
  }

  // ===================================================================
  // คลิกเลือกคำตอบ
  // ===================================================================
  function selectChoice(choice) {
    const el = choice.radio;
    if (choice.type === 'gform') {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
      el.click();
    } else {
      if (el.type === 'radio' || el.type === 'checkbox') {
        el.checked = true;
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.click();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }
  }

  // ===================================================================
  // Utilities
  // ===================================================================
  function letter(idx) {
    return String.fromCharCode(97 + idx); // 0→a, 1→b ...
  }

  // ===================================================================
  // จุดสถานะ stealth — มองเห็นแค่ผู้ใช้เอง
  // 🟡 loading | 🟢 done | 🔴 error
  // ===================================================================
  function setDot(queEl, state) {
    const cls = '__qaa_dot';
    let dot = queEl.querySelector('.' + cls);
    if (!dot) {
      dot = document.createElement('span');
      dot.className = cls;
      Object.assign(dot.style, {
        position: 'absolute',
        top: '6px',
        right: '6px',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        zIndex: '99999',
        pointerEvents: 'none',
        transition: 'background-color 0.4s ease'
      });
      if (window.getComputedStyle(queEl).position === 'static') {
        queEl.style.position = 'relative';
      }
      queEl.appendChild(dot);
    }
    const colors = { loading: '#f59e0b', done: '#10b981', error: '#ef4444' };
    dot.style.backgroundColor = colors[state] || '#9ca3af';
    if (state === 'done' || state === 'error') {
      setTimeout(() => dot && dot.remove(), 3500);
    }
  }
})();

;(function () {
  'use strict';

  let busy = false;

  document.addEventListener('dblclick', function (e) {
    if (busy) return;

    // --- หา container ของข้อสอบที่ใกล้ที่สุด ---
    const queEl = findQuestionContainer(e.target);
    if (!queEl) return;

    // ต้อง double-click บนส่วนโจทย์ ไม่ใช่ตัวเลือก
    const isOnQuestion = isClickOnQuestionText(e.target, queEl);
    if (!isOnQuestion) return;

    e.preventDefault();

    // --- ดึงข้อความโจทย์ ---
    const questionText = extractQuestionText(queEl);
    if (!questionText) return;

    // --- ดึงตัวเลือก ---
    const choices = extractChoices(queEl);
    if (choices.length === 0) return;

    busy = true;
    setDot(queEl, 'loading');

    chrome.runtime.sendMessage(
      {
        action: 'getAnswer',
        question: questionText,
        choices: choices.map(c => ({ letter: c.letter, text: c.text }))
      },
      function (response) {
        busy = false;

        if (chrome.runtime.lastError || !response) {
          setDot(queEl, 'error');
          console.warn('[QuizAA] runtime error:', chrome.runtime.lastError?.message);
          return;
        }

        if (response.error) {
          setDot(queEl, 'error');
          console.warn('[QuizAA]', response.error);
          return;
        }

        if (response.answer) {
          const idx = response.answer.charCodeAt(0) - 97; // 'a'=0
          if (choices[idx]) {
            selectChoice(choices[idx]);
            setDot(queEl, 'done');
            console.info('[QuizAA] ตอบ:', response.answer.toUpperCase(), '→', choices[idx].text);
          } else {
            setDot(queEl, 'error');
            console.warn('[QuizAA] ไม่พบตัวเลือก index:', idx, 'จำนวนตัวเลือก:', choices.length);
          }
        }
      }
    );
  });

  // ===================================================================
  // หา container ของข้อสอบ — รองรับหลาย layout
  // ===================================================================
  function findQuestionContainer(target) {
    // Priority 1: Moodle .que
    const moodle = target.closest('.que');
    if (moodle) return moodle;

    // Priority 2: Moodle .formulation wrapper
    const formulation = target.closest('.formulation');
    if (formulation) return formulation.closest('.que') || formulation;

    // Priority 3: Google Forms question block
    const gform = target.closest('[data-params]') ||
                  target.closest('[jsmodel]') ||
                  target.closest('.freebirdFormviewerViewItemsItemItem');
    if (gform) return gform;

    // Priority 4: Microsoft Forms
    const msform = target.closest('.question-content') ||
                   target.closest('[class*="question"]');
    if (msform) return msform;

    // Priority 5: Generic — หา element ที่มี radio/checkbox อยู่ใกล้ๆ
    let el = target;
    for (let i = 0; i < 8; i++) {
      if (!el || el === document.body) break;
      el = el.parentElement;
      if (el && el.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0) {
        return el;
      }
    }

    return null;
  }

  // ===================================================================
  // ตรวจว่า double-click ตรงส่วนโจทย์ (ไม่ใช่ตัวเลือก)
  // ===================================================================
  function isClickOnQuestionText(target, queEl) {
    // ถ้าคลิกบน radio/checkbox หรือ label ของตัวเลือก = ไม่นับ
    if (target.closest('input[type="radio"]')) return false;
    if (target.closest('input[type="checkbox"]')) return false;

    // Moodle: คลิกบน .qtext, .formulation, .info = OK
    if (target.closest('.qtext')) return true;
    if (target.closest('.formulation')) return true;
    if (target.closest('.info')) return true;

    // Generic: คลิกบน .answer /.options container = ไม่นับ
    if (target.closest('.answer')) return false;
    if (target.closest('[class*="option"]')) return false;
    if (target.closest('[class*="choice"]')) return false;

    // ถ้าไม่มี radio/checkbox อยู่ใน element ที่คลิก = น่าจะเป็นโจทย์
    const hasInput = target.querySelectorAll &&
      target.querySelectorAll('input[type="radio"],input[type="checkbox"]').length > 0;
    if (hasInput) return false;

    return true;
  }

  // ===================================================================
  // ดึงข้อความโจทย์ — รองรับหลาย layout
  // ===================================================================
  function extractQuestionText(queEl) {
    // Moodle
    const qtext = queEl.querySelector('.qtext');
    if (qtext) return qtext.innerText.trim();

    // Moodle formulation (บางธีม)
    const formulation = queEl.querySelector('.formulation .qtext') ||
                        queEl.querySelector('.formulation');
    if (formulation) {
      const clone = formulation.cloneNode(true);
      clone.querySelector && clone.querySelectorAll('.answer, .ablock').forEach(n => n.remove());
      return clone.innerText.trim();
    }

    // Generic: หา paragraph/div แรกที่ไม่มี input อยู่ข้างใน
    const candidates = queEl.querySelectorAll('p, h3, h4, [class*="question-text"], [class*="stem"]');
    for (const el of candidates) {
      if (el.querySelector('input')) continue;
      const text = el.innerText.trim();
      if (text.length > 5) return text;
    }

    // Last resort: ข้อความทั้งหมดในก้อน ตัด option ออก
    const clone = queEl.cloneNode(true);
    clone.querySelectorAll('input, label, .answer, [class*="option"]').forEach(n => n.remove());
    const text = clone.innerText.trim();
    return text.length > 5 ? text : null;
  }

  // ===================================================================
  // ดึงตัวเลือก — รองรับหลาย layout
  // ===================================================================
  function extractChoices(queEl) {
    let choices = [];

    // --- วิธีที่ 1: Moodle standard .answer > div ---
    const moodleDivs = queEl.querySelectorAll('.answer > div');
    if (moodleDivs.length > 0) {
      moodleDivs.forEach((div, idx) => {
        const radio = div.querySelector('input[type="radio"], input[type="checkbox"]');
        const label = div.querySelector('label');
        if (radio && label) {
          choices.push({ letter: letter(idx), text: cleanLabelText(label), radio, type: 'moodle' });
        }
      });
    }

    // --- วิธีที่ 2: Moodle inline radio+label ไม่มี wrapper div ---
    if (choices.length === 0) {
      const radios = queEl.querySelectorAll('.answer input[type="radio"], .answer input[type="checkbox"]');
      radios.forEach((radio, idx) => {
        const label = queEl.querySelector(`label[for="${radio.id}"]`) || radio.closest('label');
        if (label) {
          choices.push({ letter: letter(idx), text: cleanLabelText(label), radio, type: 'moodle-inline' });
        }
      });
    }

    // --- วิธีที่ 3: Google Forms (role="radio" / role="checkbox") ---
    if (choices.length === 0) {
      const gfOptions = queEl.querySelectorAll('[role="radio"], [role="checkbox"]');
      gfOptions.forEach((el, idx) => {
        const text = el.getAttribute('aria-label') ||
                     el.querySelector('[class*="label"]')?.innerText ||
                     el.innerText.trim();
        if (text) {
          choices.push({ letter: letter(idx), text: text.trim(), radio: el, type: 'gform' });
        }
      });
    }

    // --- วิธีที่ 4: Generic radio input ทั่วไป ---
    if (choices.length === 0) {
      queEl.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((radio, idx) => {
        const label =
          document.querySelector(`label[for="${radio.id}"]`) ||
          radio.closest('label') ||
          radio.nextElementSibling;
        const text = label ? (label.innerText || label.textContent || '').trim() : `ตัวเลือก ${idx + 1}`;
        if (text) {
          choices.push({ letter: letter(idx), text, radio, type: 'generic' });
        }
      });
    }

    // --- วิธีที่ 5: li/div ที่ดูเหมือนตัวเลือก (ไม่มี input แต่ clickable) ---
    if (choices.length === 0) {
      const items = queEl.querySelectorAll('li, [class*="option"], [class*="choice"], [class*="answer"]');
      items.forEach((el, idx) => {
        if (el.querySelector('input')) return; // ข้าม ถ้ามี input อยู่แล้ว
        const text = el.innerText.trim();
        if (text.length > 1) {
          choices.push({ letter: letter(idx), text, radio: el, type: 'clickable' });
        }
      });
    }

    return choices;
  }

  // ===================================================================
  // คลิกเลือกคำตอบ — รองรับทุก type
  // ===================================================================
  function selectChoice(choice) {
    const el = choice.radio;

    if (choice.type === 'gform') {
      // Google Forms ใช้ keyboard event
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.click();
    } else if (choice.type === 'clickable') {
      el.click();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } else {
      // Moodle & generic radio
      if (!el.checked) {
        el.click();
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // ===================================================================
  // Utilities
  // ===================================================================
  function letter(idx) {
    return String.fromCharCode(97 + idx); // 0→a, 1→b ...
  }

  // ลบ prefix "a. " / "ก. " / "1. " ที่ Moodle ใส่ใน .answernumber
  function cleanLabelText(labelEl) {
    const clone = labelEl.cloneNode(true);
    clone.querySelectorAll('.answernumber, .answer-number').forEach(n => n.remove());
    return clone.innerText.trim();
  }

  // ===================================================================
  // จุดสถานะ stealth — มองเห็นแค่ผู้ใช้เอง
  // 🟡 loading | 🟢 done | 🔴 error
  // ===================================================================
  function setDot(queEl, state) {
    const cls = '__qaa_dot';
    let dot = queEl.querySelector('.' + cls);

    if (!dot) {
      dot = document.createElement('span');
      dot.className = cls;
      Object.assign(dot.style, {
        position: 'absolute',
        top: '6px',
        right: '6px',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        zIndex: '99999',
        pointerEvents: 'none',
        transition: 'background-color 0.4s ease'
      });
      const pos = window.getComputedStyle(queEl).position;
      if (pos === 'static') queEl.style.position = 'relative';
      queEl.appendChild(dot);
    }

    const colors = { loading: '#f59e0b', done: '#10b981', error: '#ef4444' };
    dot.style.backgroundColor = colors[state] || '#9ca3af';

    if (state === 'done' || state === 'error') {
      setTimeout(() => dot && dot.remove(), 3500);
    }
  }
})();
