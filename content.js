// content.js — Universal quiz auto-answer
// trigger: double-click ที่ใดก็ได้ใน block ข้อสอบ (ยกเว้นบน radio โดยตรง)
// keyboard: Z = เปิด, A = ปิด

;(function () {
  'use strict';

  let busy    = false;
  let enabled = true; // default เปิด

  // ===================================================================
  // โหลด enabled state จาก storage (คงค่าข้าม reload)
  // ===================================================================
  chrome.storage.local.get('extEnabled', function (data) {
    enabled = data.extEnabled !== false; // undefined = เปิด default
  });

  // sync ทันทีเมื่อ popup เปลี่ยน
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.extEnabled !== undefined) {
      enabled = changes.extEnabled.newValue !== false;
      showToast(enabled ? 'เปิดอยู่' : 'ปิดอยู่', enabled);
    }
  });

  // ===================================================================
  // Keyboard shortcut: Z = เปิด, A = ปิด
  // capture: true → รับ event ก่อน page script ทุกตัว
  // ทำงานได้ไม่ว่า focus จะอยู่ที่ element ไหนในหน้าจอ
  // ===================================================================
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'z' || e.key === 'Z') {
      enabled = true;
      chrome.storage.local.set({ extEnabled: true });
      showToast('เปิดอยู่', true);
    } else if (e.key === 'a' || e.key === 'A') {
      enabled = false;
      chrome.storage.local.set({ extEnabled: false });
      showToast('ปิดอยู่', false);
    }
  }, true); // true = capture phase

  // ===================================================================
  // Toast notification แจ้งสถานะ
  // ===================================================================
  function showToast(msg, isOn) {
    var id  = '__qaa_toast';
    var old = document.getElementById(id);
    if (old) old.remove();

    var el = document.createElement('div');
    el.id = id;
    el.textContent = (isOn ? '🟢 ' : '🔴 ') + 'Auto Search: ' + msg;
    Object.assign(el.style, {
      position:     'fixed',
      bottom:       '24px',
      right:        '24px',
      background:   isOn ? '#064e3b' : '#1e293b',
      color:        isOn ? '#6ee7b7' : '#94a3b8',
      border:       '1px solid ' + (isOn ? '#059669' : '#334155'),
      borderRadius: '8px',
      padding:      '8px 14px',
      fontSize:     '13px',
      fontFamily:   'sans-serif',
      zIndex:       '2147483647',
      pointerEvents:'none',
      opacity:      '1',
      transition:   'opacity 0.4s ease'
    });
    // document.body.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 400);
    }, 1800);
  }

  document.addEventListener('dblclick', function (e) {
    if (!enabled) return;
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

    if (!chrome.runtime?.sendMessage) {
      busy = false;
      setDot(queEl, 'error');
      console.warn('[QuizAA] extension context invalidated — reload the page');
      return;
    }

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

    // Generic — เดินขึ้น DOM ไม่จำกัดระดับ หา container ที่เล็กที่สุดที่มี radio/checkbox >= 2
    let el = target.parentElement;
    while (el && el !== document.body) {
      if (el.querySelectorAll('input[type="radio"], input[type="checkbox"]').length >= 2) return el;
      el = el.parentElement;
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

    // วิธี 3: Universal — clone แล้วตัด block ตัวเลือกออก เหลือแต่ข้อความโจทย์
    var t3 = extractTextBeforeChoices(queEl);
    if (t3 && t3.length > 5) return t3;

    // วิธี 4: ค้นหา tag ที่น่าจะเป็นโจทย์
    var stemSelectors = 'p, h2, h3, h4, [class*="stem"], [class*="question-text"], [class*="question_text"], [class*="prompt"], [class*="content"]';
    var tags = queEl.querySelectorAll(stemSelectors);
    for (var i = 0; i < tags.length; i++) {
      var tagEl = tags[i];
      if (tagEl.querySelector('input, select')) continue;
      var t4 = cleanQuestionText(tagEl.innerText);
      if (t4.length > 5) return t4;
    }

    // วิธี 5: clone ทั้งหมด ลบ input/label/choice elements
    var clone = queEl.cloneNode(true);
    clone.querySelectorAll('input, label, .answer, [class*="option"], [class*="choice"]').forEach(function(n){ n.remove(); });
    var t = cleanQuestionText(clone.innerText);
    return t.length > 5 ? t : null;
  }

  // ดึงข้อความโจทย์โดยการ clone container แล้วตัด block ตัวเลือกออก
  // รองรับทุก layout: ol/ul list, div rows, tr rows
  function extractTextBeforeChoices(queEl) {
    var clone = queEl.cloneNode(true);
    var firstInput = clone.querySelector('input[type="radio"], input[type="checkbox"]');
    if (!firstInput) return null;

    // หา "choices block" — ol/ul ที่ครอบตัวเลือกทั้งหมด
    var choiceBlock = firstInput.closest('ol, ul');

    if (!choiceBlock) {
      // หา ancestor ที่เป็น direct child ของ clone (= block ตัวเลือก)
      choiceBlock = firstInput.parentElement;
      while (choiceBlock && choiceBlock.parentElement !== clone) {
        choiceBlock = choiceBlock.parentElement;
      }
    }

    if (choiceBlock) {
      choiceBlock.remove();
    } else {
      // fallback: ลบ container ของแต่ละ radio
      clone.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(function(inp) {
        var p = inp.closest('li, tr') || inp.parentElement;
        if (p && p !== clone) p.remove();
      });
    }

    return cleanQuestionText(clone.innerText);
  }

  function cleanQuestionText(raw) {
    return raw
      .replace(/select\s+one\s*:/gi, '')
      .replace(/เลือก(หนึ่ง|one)?\s*ข้อ\s*:/gi, '')
      .replace(/choose\s+(one|the\s+best)\s*:/gi, '')
      .replace(/[\t ]+/g, ' ')               // collapse spaces/tabs
      .replace(/(\r?\n|\r){3,}/g, '\n\n')    // max 2 newlines ติดกัน
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

    // วิธี 4: Generic — ครอบคลุมทุก website (li / td / div / label)
    if (choices.length < 2) {
      choices = [];
      queEl.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(function(radio, idx) {
        var labelText = '';

        // 4a. label[for="id"]
        if (radio.id) {
          var forLabel = document.querySelector('label[for="' + radio.id + '"]');
          if (forLabel) labelText = forLabel.innerText || forLabel.textContent || '';
        }
        // 4b. radio ซ้อนอยู่ใน <label>
        if (!labelText.trim()) {
          var wrappingLabel = radio.closest('label');
          if (wrappingLabel) {
            var lc = wrappingLabel.cloneNode(true);
            lc.querySelectorAll('input').forEach(function(n){ n.remove(); });
            labelText = lc.innerText || lc.textContent || '';
          }
        }
        // 4c. sibling element ถัดไป (span, div, p)
        if (!labelText.trim() && radio.nextElementSibling) {
          labelText = radio.nextElementSibling.innerText || radio.nextElementSibling.textContent || '';
        }
        // 4d. container ใกล้ที่สุด (li / td / p / div) ลบ input ออกแล้วเอาข้อความ
        if (!labelText.trim()) {
          var container = radio.closest('li, td, p') ||
            (radio.parentElement !== queEl ? radio.parentElement : null);
          if (container) {
            var cc = container.cloneNode(true);
            cc.querySelectorAll('input').forEach(function(n){ n.remove(); });
            labelText = cc.innerText || cc.textContent || '';
          }
        }
        // 4e. value attribute เป็น fallback สุดท้าย
        if (!labelText.trim()) labelText = radio.value || '';

        var text = stripChoicePrefix(labelText.trim());
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
      .replace(/[\t ]+/g, ' ')               // collapse spaces/tabs
      .replace(/(\r?\n|\r){2,}/g, ' ')       // collapse newlines ในตัวเลือกให้เป็น space
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
        width: '2px',
        height: '2px',
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
    dot.style.backgroundColor = colors[state] || '#9ca3af';
    if (state === 'done' || state === 'error') {
      setTimeout(function() { if (dot) dot.remove(); }, 500);
    }
  }

})();
