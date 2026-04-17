// content.js — Universal quiz auto-answer
// trigger: double-click ที่ใดก็ได้ใน block ข้อสอบ (ยกเว้นบน radio โดยตรง)

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
    console.info('[QuizAA] ตัวเลือก:', choices.map(c => c.letter + '. ' + c.text));

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
    const que = target.closest('.que');
    if (que) return que;

    const formulation = target.closest('.formulation');
    if (formulation) return formulation;

    const gform =
      target.closest('.freebirdFormviewerViewItemsItemItem') ||
      target.closest('[data-params]') ||
      target.closest('[jsmodel]');
    if (gform) return gform;

    // Generic — เดินขึ้น DOM หา container ที่มี radio >= 2
    let el = target;
    for (let i = 0; i < 10; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      if (el.querySelectorAll('input[type="radio"], input[type="checkbox"]').length >= 2) return el;
    }
    return null;
  }

  // ===================================================================
  // ดึงข้อความโจทย์
  // ===================================================================
  function extractQuestionText(queEl) {
    const qtext = queEl.querySelector('.qtext');
    if (qtext) return cleanQuestionText(qtext.innerText);

    const formClone = queEl.querySelector('.formulation') && queEl.querySelector('.formulation').cloneNode(true);
    if (formClone) {
      formClone.querySelectorAll('.answer, .ablock, .im-controls').forEach(function(n){ n.remove(); });
      const t = cleanQuestionText(formClone.innerText);
      if (t.length > 5) return t;
    }

    const tags = queEl.querySelectorAll('p, h3, h4, [class*="stem"], [class*="question-text"]');
    for (let i = 0; i < tags.length; i++) {
      const el = tags[i];
      if (el.querySelector('input, select')) continue;
      const t = cleanQuestionText(el.innerText);
      if (t.length > 5) return t;
    }

    const clone = queEl.cloneNode(true);
    clone.querySelectorAll('input, label, .answer, [class*="option"], [class*="choice"]').forEach(function(n){ n.remove(); });
    const t = cleanQuestionText(clone.innerText);
    return t.length > 5 ? t : null;
  }

  function cleanQuestionText(raw) {
    return raw
      .replace(/select\s+one\s*:/gi, '')
      .replace(/เลือก(หนึ่ง|one)?\s*ข้อ\s*:/gi, '')
      .replace(/choose\s+(one|the\s+best)\s*:/gi, '')
      .replace(/^\s*[\r\n]+/gm, '')
      .trim();
  }

  // ===================================================================
  // ดึงตัวเลือก
  // ===================================================================
  function extractChoices(queEl) {
    var choices = [];

    // วิธี 1: Moodle .answer > div
    var moodleDivs = queEl.querySelectorAll('.answer > div');
    if (moodleDivs.length >= 2) {
      moodleDivs.forEach(function(div, idx) {
        var radio = div.querySelector('input[type="radio"], input[type="checkbox"]');
        var label = div.querySelector('label');
        if (radio && label) {
          choices.push({ letter: letter(idx), text: cleanChoiceText(label), radio: radio, type: 'moodle' });
        }
      });
    }

    // วิธี 2: Moodle .answer inline
    if (choices.length < 2) {
      choices = [];
      var answerEl = queEl.querySelector('.answer');
      if (answerEl) {
        answerEl.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(function(radio, idx) {
          var label =
            queEl.querySelector('label[for="' + radio.id + '"]') ||
            radio.closest('label') ||
            radio.nextElementSibling;
          if (label) {
            choices.push({ letter: letter(idx), text: cleanChoiceText(label), radio: radio, type: 'moodle-inline' });
          }
        });
      }
    }

    // วิธี 3: Google Forms
    if (choices.length < 2) {
      choices = [];
      queEl.querySelectorAll('[role="radio"], [role="checkbox"]').forEach(function(el, idx) {
        var text =
          el.getAttribute('aria-label') ||
          (el.querySelector('[class*="label"], [class*="text"]') && el.querySelector('[class*="label"], [class*="text"]').innerText) ||
          el.innerText.trim();
        if (text && text.length > 0) {
          choices.push({ letter: letter(idx), text: text.trim(), radio: el, type: 'gform' });
        }
      });
    }

    // วิธี 4: Generic radio
    if (choices.length < 2) {
      choices = [];
      queEl.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(function(radio, idx) {
        var label =
          document.querySelector('label[for="' + radio.id + '"]') ||
          radio.closest('label') ||
          radio.nextElementSibling;
        var rawText = label
          ? (label.innerText || label.textContent || '').trim()
          : radio.value || 'ตัวเลือก ' + (idx + 1);
        var text = stripChoicePrefix(rawText);
        if (text) {
          choices.push({ letter: letter(idx), text: text, radio: radio, type: 'generic' });
        }
      });
    }

    return choices;
  }

  function cleanChoiceText(labelEl) {
    var clone = labelEl.cloneNode(true);
    clone.querySelectorAll('.answernumber, .answer-number, .num').forEach(function(n){ n.remove(); });
    return stripChoicePrefix(clone.innerText.trim());
  }

  function stripChoicePrefix(text) {
    return text
      .replace(/^[0-9]+[.)]\s*/, '')
      .replace(/^[a-eA-E][.)]\s*/, '')
      .replace(/^[ก-ฮ][.)]\s*/, '')
      .replace(/^[ivxIVX]+[.)]\s*/i, '')
      .trim();
  }

  // ===================================================================
  // คลิกเลือกคำตอบ
  // ===================================================================
  function selectChoice(choice) {
    var el = choice.radio;
    if (choice.type === 'gform') {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
      el.click();
    } else if (el.type === 'radio' || el.type === 'checkbox') {
      el.checked = true;
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.click();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }

  function letter(idx) {
    return String.fromCharCode(97 + idx);
  }

  // ===================================================================
  // จุดสถานะ stealth — 🟡 loading | 🟢 done | 🔴 error
  // ===================================================================
  function setDot(queEl, state) {
    var cls = '__qaa_dot';
    var dot = queEl.querySelector('.' + cls);
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
    var colors = { loading: '#f59e0b', done: '#10b981', error: '#ef4444' };
    // dot.style.backgroundColor = colors[state] || '#9ca3af';
    if (state === 'done' || state === 'error') {
      setTimeout(function() { if (dot) dot.remove(); }, 3500);
    }
  }

})();
