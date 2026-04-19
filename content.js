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

  var longPressTimer = null;
  var longPressTarget = null;
  var dotTimer = null;          // delay ก่อนแสดง dot (เพื่อไม่โชว์ตอนลาก)
  var startX = 0;
  var startY = 0;
  var LONG_PRESS_MS = 3000;     // 3 วินาที
  var DOT_DELAY_MS  = 200;      // รอ 200ms ก่อนแสดง dot (กันกระพริบตอนลาก)
  var MOVE_THRESHOLD = 6;       // px — ถ้าเลื่อนเกินนี้ถือว่าลาก ยกเลิกทันที

  document.addEventListener('mousedown', function (e) {
    if (!enabled) return;
    if (busy) return;
    if (e.button !== 0) return; // เฉพาะคลิกซ้าย

    // ห้าม trigger ถ้าคลิกบน radio/checkbox/ปุ่มโดยตรง
    if (e.target.matches('input, button, a, select, textarea')) return;

    // หา container ข้อสอบ
    var queEl = findQuestionContainer(e.target);
    if (!queEl) return;

    startX = e.clientX;
    startY = e.clientY;
    longPressTarget = { queEl: queEl, targetEl: e.target };

    // แสดง dot หลัง 200ms (ถ้าลากก่อน = ไม่แสดงเลย)
    dotTimer = setTimeout(function () {
      dotTimer = null;
      if (longPressTarget) setDot(longPressTarget.queEl, 'holding');
    }, DOT_DELAY_MS);

    longPressTimer = setTimeout(function () {
      longPressTimer = null;
      if (!longPressTarget) return;

      var questionText = extractQuestionText(longPressTarget.queEl);
      if (!questionText || questionText.length < 3) {
        setDot(longPressTarget.queEl, 'error');
        longPressTarget = null;
        return;
      }

      // ===== ตรวจสอบว่าเป็น Matrix question (หลายข้อย่อย × N ตัวเลือก) =====
      var matrixResult = detectAndExtractMatrix(longPressTarget.queEl);
      if (matrixResult && matrixResult.subs.length >= 2) {
        // console.info('[matrix] detected', matrixResult.subs.length, 'subs, cols:', matrixResult.columnHeaders, '\ninstr:', matrixResult.instruction);
        busy = true;
        setDot(longPressTarget.queEl, 'working');
        var _queEl = longPressTarget.queEl;
        var _subs  = matrixResult.subs;
        var _cols  = matrixResult.columnHeaders;
        var _instr = matrixResult.instruction || questionText;
        longPressTarget = null;
        if (!chrome.runtime || !chrome.runtime.sendMessage) {
          busy = false; setDot(_queEl, 'error'); return;
        }
        chrome.runtime.sendMessage(
          {
            action: 'getMatrixAnswer',
            instruction: _instr,
            columnHeaders: _cols,
            subQuestions: _subs.map(function(sq) { return { text: sq.text }; })
          },
          function (response) {
            busy = false;
            // console.info('[matrix] response:', JSON.stringify(response));
            if (chrome.runtime.lastError || !response || response.error) {
              // console.warn('[matrix] error:', response && response.error, chrome.runtime.lastError && chrome.runtime.lastError.message);
              setDot(_queEl, 'error'); return;
            }
            if (response.answers && response.answers.length) {
              response.answers.forEach(function(ans, i) {
                if (!_subs[i]) return;
                var radioIdx = parseInt(ans, 10) - 1;
                if (isNaN(radioIdx) || radioIdx < 0) return;
                var r = _subs[i].radios[radioIdx];
                if (r) {
                  r.checked = true;
                  r.click();
                  r.dispatchEvent(new Event('change', { bubbles: true }));
                }
              });
              setDot(_queEl, 'done');
            }
          }
        );
        return;
      }

      var choices = extractChoices(longPressTarget.queEl);
      if (choices.length === 0) {
        setDot(longPressTarget.queEl, 'error');
        longPressTarget = null;
        return;
      }

      busy = true;
      setDot(longPressTarget.queEl, 'working');

      // console.info('[info] โจทย์:', questionText);
      // console.info('[info] ตัวเลือก:', choices.map(function(c){ return c.letter + '. ' + c.text; }));

      var _queEl = longPressTarget.queEl;
      longPressTarget = null;

      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        busy = false;
        setDot(_queEl, 'error');
        // console.warn('[info] extension context invalidated — reload the page');
        return;
      }

      chrome.runtime.sendMessage(
        {
          action: 'getAnswer',
          question: questionText,
          choices: choices.map(function(c){ return { letter: c.letter, text: c.text }; })
        },
        function (response) {
          busy = false;
          if (chrome.runtime.lastError || !response) {
            setDot(_queEl, 'error');
            // console.warn('[info] runtime error:', chrome.runtime.lastError && chrome.runtime.lastError.message);
            return;
          }
          if (response.error) {
            setDot(_queEl, 'error');
            // console.warn('[info] API error:', response.error);
            return;
          }
          if (response.answer) {
            var idx = response.answer.charCodeAt(0) - 97;
            if (choices[idx]) {
              selectChoice(choices[idx]);
              setDot(_queEl, 'done');
              // console.info('[info] ✓ ตอบ:', response.answer.toUpperCase(), '→', choices[idx].text);
            } else {
              setDot(_queEl, 'error');
              // console.warn('[info] ไม่พบ index:', idx, '/ มีทั้งหมด:', choices.length);
            }
          }
        }
      );
    }, LONG_PRESS_MS);
  });

  // ยกเลิกถ้าปล่อยก่อนครบเวลา หรือเลื่อน mouse เกิน threshold
  function cancelLongPress(force) {
    if (dotTimer) { clearTimeout(dotTimer); dotTimer = null; }
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      if (longPressTarget) {
        var dot = longPressTarget.queEl.querySelector('.__qaa_dot');
        if (dot) dot.remove();
        longPressTarget = null;
      }
    }
  }

  document.addEventListener('mouseup', cancelLongPress);
  document.addEventListener('scroll',  cancelLongPress, true);

  // mousemove: ยกเลิกเฉพาะเมื่อเลื่อนเกิน threshold (กันสั่น)
  document.addEventListener('mousemove', function (e) {
    if (!longPressTimer && !dotTimer) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
      cancelLongPress();
    }
  });

  // บล็อค contextmenu (คลิกขวา) เพื่อไม่ให้เปิด popup ของ browser พร้อมกัน
  // เฉพาะช่วงที่ long press timer กำลังนับจนครบแล้ว (working state) เท่านั้น
  document.addEventListener('contextmenu', function (e) {
    if (busy) {
      e.preventDefault();
    }
  }, true);

  // บล็อค dblclick ทั่วทั้งหน้า → กัน dictionary / Look Up popup
  document.addEventListener('dblclick', function (e) {
    if (!(e.target instanceof Element)) return;
    if (e.target.matches('input, button, a, select, textarea')) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // บล็อค selectstart ทั่วทั้งหน้า → กัน dictionary extension popup
  document.addEventListener('selectstart', function (e) {
    if (!(e.target instanceof Element)) return;
    if (e.target.matches('input, button, a, select, textarea')) return;
    e.preventDefault();
  }, true);

  // MutationObserver — ซ่อน dictionary popup ที่ extension อื่น inject เข้ามาทันที
  (function () {
    // CSS inject: ซ่อน popup ที่รู้จักเป็น default ก่อนเลย
    var style = document.createElement('style');
    style.textContent = [
      // Longdo / common Thai dictionary extensions
      '#ldpopup, #ld-popup, #ldtooltip, #ld_popup',
      // Translate / lookup popup ทั่วไป
      '[id*="dict"],[id*="Dict"],[id*="popup"],[id*="Popup"],[id*="tooltip"],[id*="Tooltip"]',
      '[class*="dict-popup"],[class*="dictPopup"],[class*="dict_popup"]',
      '[class*="lookup-popup"],[class*="lookupPopup"]',
      '[class*="translate-popup"],[class*="translatePopup"]',
      // Chrome extension shadow-host ที่ inject บน body
      'body > div[style*="z-index: 2147483647"]:not(#__qaa_toast)',
      'body > div[style*="z-index:2147483647"]:not(#__qaa_toast)',
    ].join(',') + ' { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);

    // Observer: popup ที่ inject หลัง page load → ซ่อนทันที
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          var id  = (node.id || '').toLowerCase();
          var cls = (node.className || '').toLowerCase();
          var isDictPopup =
            /dict|popup|tooltip|lookup|translate/.test(id) ||
            /dict.?popup|lookup.?popup|translate.?popup/.test(cls);
          if (isDictPopup && node.id !== '__qaa_toast') {
            node.style.setProperty('display', 'none', 'important');
          }
        });
      });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  })();

  // -- stub เพื่อให้ code ด้านล่างที่ใช้ sendMessage เดิมยังทำงานได้ --
  // (ย้ายไปอยู่ใน longPress callback แล้ว ข้างล่างนี้จะไม่ถูกเรียก)
  if (false) { // dead code block — เก็บไว้เพื่อไม่ให้ parser error
    var e = {};
    if (!enabled) return;
    if (busy) return;
    if (e.target && e.target.matches('input, button, a, select, textarea')) return;
    var queEl = findQuestionContainer(e.target);
    if (!queEl) return;
    e.preventDefault && e.preventDefault();
    var questionText = extractQuestionText(queEl);
    if (!questionText || questionText.length < 3) return;
    var choices = extractChoices(queEl);
    if (choices.length === 0) return;
    busy = true;
    setDot(queEl, 'loading');

    // console.info('[info] โจทย์:', questionText);
    // console.info('[info] ตัวเลือก:', choices.map(c => c.letter + '. ' + c.text));

    if (!chrome.runtime?.sendMessage) {
      busy = false;
      setDot(queEl, 'error');
      // console.warn('[info] extension context invalidated — reload the page');
      return;
    }

  } // end dead code block

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
      .replace(/^[a-zA-Z][.)]\s*/, '')
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
  // Matrix question — ตรวจจับ + ดึงข้อมูล grid quiz
  // รองรับทั้ง name-grouped และ table-row layout
  // ===================================================================
  function detectAndExtractMatrix(queEl) {
    // ===== ขยาย scope ถ้า queEl อยู่ใน <table> =====
    // findQuestionContainer อาจคืน <tr> ที่มีแค่ 2 radios → ต้องไต่ขึ้นหา table
    var tableEl = queEl.querySelector('table');
    var scopeEl = queEl;

    if (!tableEl) {
      // queEl อาจอยู่ภายใน table (เช่น เป็น tr/td) → หา table ที่ครอบ
      tableEl = queEl.closest('table');
      if (tableEl) {
        // ไต่ขึ้น DOM จาก table เพื่อหา container ที่ครอบทั้ง instruction + table
        var p = tableEl.parentElement;
        while (p && p !== document.body) {
          scopeEl = p;
          if (p.querySelectorAll('input[type="radio"]').length >= 4) break;
          p = p.parentElement;
        }
        if (scopeEl === queEl) scopeEl = tableEl.parentElement || tableEl;
        // อัปเดต tableEl ให้ตรงกับ scopeEl
        tableEl = scopeEl.querySelector('table') || tableEl;
      }
    }

    var allRadios = scopeEl.querySelectorAll('input[type="radio"]');
    // console.info('[matrix-detect] scopeEl radios:', allRadios.length, '| has table:', !!tableEl);
    if (allRadios.length < 4) return null;

    // ===== Method 1: Group by <tr> (ทนทานกว่า name-based) =====
    if (tableEl) {
      var rowGroups = [];
      tableEl.querySelectorAll('tr').forEach(function(row) {
        var rowRadios = Array.from(row.querySelectorAll('input[type="radio"]'));
        if (rowRadios.length >= 2) rowGroups.push(rowRadios);
      });

      // console.info('[matrix-detect] rowGroups:', rowGroups.length, '| cols:', rowGroups[0] ? rowGroups[0].length : 0);

      if (rowGroups.length >= 2) {
        var firstCount = rowGroups[0].length;
        if (firstCount >= 2 && firstCount <= 8) {
          var allSame = rowGroups.every(function(g) { return g.length === firstCount; });
          if (allSame) {
            // ===== column headers =====
            var columnHeaders = [];
            var headerRow = null;
            // ลอง thead ก่อน
            var theadRow = tableEl.querySelector('thead tr');
            if (theadRow && theadRow.querySelectorAll('input[type="radio"]').length === 0) {
              headerRow = theadRow;
            }
            // ถ้าไม่มี thead ลอง tr แรกที่ไม่มี radio
            if (!headerRow) {
              var trs = tableEl.querySelectorAll('tr');
              for (var ti = 0; ti < trs.length; ti++) {
                if (trs[ti].querySelectorAll('input[type="radio"]').length === 0) {
                  headerRow = trs[ti];
                  break;
                }
              }
            }
            if (headerRow) {
              headerRow.querySelectorAll('th, td').forEach(function(cell) {
                var t = cell.innerText.trim();
                if (t) columnHeaders.push(t);
              });
              // ถ้า headers มีมากกว่าจำนวน column ตัด header คอลัมน์แรก (หัวโจทย์) ออก
              if (columnHeaders.length > firstCount) {
                columnHeaders = columnHeaders.slice(columnHeaders.length - firstCount);
              }
              if (columnHeaders.length === 1) columnHeaders = []; // ไม่มีประโยชน์
            }
            // fallback: value ของ radio แถวแรก
            if (columnHeaders.length === 0) {
              rowGroups[0].forEach(function(r) {
                var v = r.value || r.getAttribute('data-value') || '';
                if (v && v !== 'on') columnHeaders.push(v);
              });
            }

            // ===== subs =====
            var subs = rowGroups.map(function(radioGroup, idx) {
              var text = '';
              var row = radioGroup[0].closest('tr');
              if (row) {
                var cells = row.querySelectorAll('td, th');
                for (var ci = 0; ci < cells.length; ci++) {
                  if (cells[ci].querySelectorAll('input[type="radio"]').length === 0) {
                    var cl = cells[ci].cloneNode(true);
                    cl.querySelectorAll('input, img, span.__qaa_dot').forEach(function(n){ n.remove(); });
                    var t = cl.innerText.trim();
                    if (t.length > 1) { text = t; break; }
                  }
                }
              }
              if (!text) text = 'ข้อ ' + (idx + 1);
              return {
                text: text.replace(/[\t ]+/g, ' ').replace(/(\r?\n|\r){2,}/g, ' ').trim(),
                radios: radioGroup,
                name: radioGroup[0].name || ('row_' + idx)
              };
            });

            var instruction = extractMatrixInstruction(scopeEl, tableEl);
            // console.info('[matrix-detect] ✓ table-row | subs:', subs.length, '| cols:', columnHeaders, '| instr:', instruction.slice(0, 60));
            return { subs: subs, columnHeaders: columnHeaders, instruction: instruction };
          }
        }
      }
    }

    // ===== Method 2: Group by name attribute (fallback) =====
    var groups = {};
    var groupOrder = [];
    allRadios.forEach(function(r) {
      var n = r.name || '';
      if (!n) return;
      if (!groups[n]) { groups[n] = []; groupOrder.push(n); }
      groups[n].push(r);
    });

    // console.info('[matrix-detect] name groups:', groupOrder.length, '| first size:', groupOrder[0] ? groups[groupOrder[0]].length : 0);

    if (groupOrder.length < 2) return null;
    var firstCount = groups[groupOrder[0]].length;
    if (firstCount < 2 || firstCount > 6) return null;
    var allSame = groupOrder.every(function(n) { return groups[n].length === firstCount; });
    if (!allSame) return null;

    // column headers
    var columnHeaders = [];
    var firstRadio = groups[groupOrder[0]][0];
    var tbl = firstRadio.closest('table');
    if (tbl) {
      var headerRows = tbl.querySelectorAll('thead tr, tbody tr:first-child');
      headerRows.forEach(function(row) {
        if (columnHeaders.length > 0) return;
        if (row.querySelector('input[type="radio"]')) return;
        row.querySelectorAll('th, td').forEach(function(cell) {
          var t = cell.innerText.trim();
          if (t) columnHeaders.push(t);
        });
      });
      if (columnHeaders.length === 1) columnHeaders = [];
    }
    if (columnHeaders.length === 0) {
      groups[groupOrder[0]].forEach(function(r) {
        var v = r.value || r.getAttribute('data-value') || '';
        if (v && v !== 'on') columnHeaders.push(v);
      });
    }

    var instruction = extractMatrixInstruction(scopeEl, tbl);
    var subs = groupOrder.map(function(name, idx) {
      var radioGroup = groups[name];
      var fr = radioGroup[0];
      var text = '';
      var row = fr.closest('tr');
      if (row) {
        var cells = row.querySelectorAll('td, th');
        for (var ci = 0; ci < cells.length; ci++) {
          if (!cells[ci].querySelector('input[type="radio"]')) {
            var cl = cells[ci].cloneNode(true);
            cl.querySelectorAll('input, img, span.__qaa_dot').forEach(function(n){ n.remove(); });
            var t = cl.innerText.trim();
            if (t.length > 1) { text = t; break; }
          }
        }
      }
      if (!text) {
        var parent = fr.closest('li, p');
        if (parent) {
          var pc = parent.cloneNode(true);
          pc.querySelectorAll('input').forEach(function(n){ n.remove(); });
          text = pc.innerText.trim();
        }
      }
      if (!text) text = 'ข้อ ' + (idx + 1);
      return {
        text: text.replace(/[\t ]+/g, ' ').replace(/(\r?\n|\r){2,}/g, ' ').trim(),
        radios: radioGroup,
        name: name
      };
    });

    // console.info('[matrix-detect] ✓ name-group | subs:', subs.length);
    return { subs: subs, columnHeaders: columnHeaders, instruction: instruction };
  }

  // ดึง instruction/หัวข้อของ matrix quiz
  // หาส่วนที่อยู่เหนือ table / เป็นคำอธิบายคะแนน
  function extractMatrixInstruction(queEl, tableEl) {
    // วิธี 1: หา element ที่อยู่ก่อน table ใน queEl
    if (tableEl) {
      var clone = queEl.cloneNode(true);
      var cloneTable = clone.querySelector('table');
      if (cloneTable) {
        // เอาเฉพาะส่วนที่อยู่ก่อน table
        cloneTable.remove();
        var t = clone.innerText.replace(/[\t ]+/g, ' ').replace(/(\r?\n|\r){3,}/g, '\n').trim();
        if (t.length > 5) return t;
      }
    }
    // วิธี 2: element ที่มี class เกี่ยวกับคำสั่ง
    var descEl = queEl.querySelector('[class*="qtext"], [class*="stem"], [class*="prompt"], [class*="instruction"]');
    if (descEl) return descEl.innerText.trim();
    return '';
  }
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
        width: '1px',
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
    var colors = { holding: '#94a3b8', working: '#09aaf5', done: '#10b981', error: '#ef4444' };
    dot.style.backgroundColor = colors[state] || '#9ca3af';
    if (state === 'done' || state === 'error') {
      setTimeout(function() { if (dot) dot.remove(); }, 500);
    }
  }

})();
