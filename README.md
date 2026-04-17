# Quiz Auto Answer — Chrome Extension

ตอบข้อสอบออนไลน์อัตโนมัติด้วย AI (OpenAI)  

---

## วิธีติดตั้ง

### ขั้นที่ 1 — เปิดหน้า Extensions ของ Chrome

1. เปิด Chrome
2. พิมพ์ในแถบ URL: `chrome://extensions/`
3. เปิด **Developer mode** (toggle มุมขวาบน)

### ขั้นที่ 2 — โหลด Extension

1. คลิกปุ่ม **"Load unpacked"**
2. เลือกโฟลเดอร์ (โฟลเดอร์นี้ root)
3. Extension **Quiz Auto Answer** จะปรากฏในรายการ

### ขั้นที่ 3 — ปักหมุด Extension บน Toolbar

1. คลิกไอคอน puzzle 🧩 บน toolbar ของ Chrome
2. กดปุ่ม 📌 ข้าง **Quiz Auto Answer** เพื่อปักหมุดไว้

---

## วิธีตั้งค่า API Key (ทำครั้งเดียว)

### หา API Key จาก OpenAI

1. ไปที่ [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Login ด้วย account OpenAI
3. คลิก **"+ Create new secret key"**
4. ตั้งชื่อ เช่น `quiz-extension`
5. คลิก **Create** → **Copy** ทันที (จะเห็นแค่ครั้งเดียว)

> ⚠️ **อย่าแชร์ key ในแชท, GitHub หรือที่สาธารณะ**

### ใส่ Key ใน Extension

1. คลิก icon **Quiz Auto Answer** บน toolbar
2. วาง key ในช่อง **OpenAI API Key**
3. เลือก **Model** (แนะนำ `gpt-4o-mini`)
4. คลิก **บันทึก**
5. ขึ้น "บันทึกสำเร็จ ✓" = พร้อมใช้งาน

Key จะถูกเก็บถาวรในเครื่อง — ไม่หายจนกว่าจะกด "ลบ Key ออก" หรือถอน extension

---

## วิธีใช้งาน

1. เปิดหน้าแบบทดสอบ 
2. **Double-click บนข้อความโจทย์** ของข้อที่ต้องการ
3. รอ 1-3 วินาที — AI จะเลือกคำตอบให้อัตโนมัติ

### สัญลักษณ์จุดที่มุมขวาบนของข้อ

| จุดสี | ความหมาย |
|-------|----------|
| 🟡 เหลือง | กำลังถาม AI อยู่ |
| 🟢 เขียว | เลือกคำตอบแล้ว |
| 🔴 แดง | เกิด Error (ดู Console) |

### ตรวจสอบ Error

1. กด `F12` → แท็บ **Console**
2. พิมพ์ `QuizAA` ในช่อง Filter
3. Double-click โจทย์ใหม่ → ดู log

---

## Model ที่รองรับ

| Model | ความแม่น | ราคา | แนะนำสำหรับ |
|-------|----------|------|------------|
| `gpt-4o-mini` ⭐ | ดี | ถูกมาก | ข้อสอบทั่วไป |
| `gpt-4o` | สูงมาก | ปานกลาง | ข้อสอบยาก |
| `o4-mini` | สูง (reasoning) | ถูก | โจทย์ต้องคิด |
| `gpt-3.5-turbo` | พอใช้ | ถูกที่สุด | ประหยัด |

---

## วิธีอัปเดตโค้ด

เมื่อแก้ไขไฟล์ใดๆ ใน `project-01` ต้องทำตามนี้เพื่อให้ Chrome โหลดโค้ดใหม่:

### ขั้นที่ 1 — Reload Extension

1. เปิด `chrome://extensions/`
2. หา card **Quiz Auto Answer**
3. คลิกปุ่ม **↺ (วงกลมลูกศร)** ที่อยู่ในการ์ด

### ขั้นที่ 2 — Reload หน้าเว็บที่เปิดอยู่

กด `⌘ + R` (Mac) หรือ `Ctrl + R` (Windows) บนหน้าข้อสอบ

> content.js ที่ inject ไปแล้วจะยังเป็นเวอร์ชันเก่า จนกว่าจะ reload หน้า

### ตารางสรุป: ไฟล์ไหน ต้อง reload อะไร

| ไฟล์ที่แก้ | ต้อง reload extension | ต้อง reload หน้าเว็บ |
|-----------|----------------------|---------------------|
| `content.js` | ✅ | ✅ |
| `background.js` | ✅ | ❌ |
| `manifest.json` | ✅ | ❌ |
| `popup.html` / `popup.js` | ❌ | ❌ (ปิด-เปิด popup) |

---

## โครงสร้างไฟล์

```
project-01/
├── manifest.json     ← config extension
├── background.js     ← เรียก OpenAI API
├── content.js        ← อ่านโจทย์ + ติ๊กคำตอบ
├── popup.html        ← หน้า settings
├── popup.js          ← บันทึก/โหลด API key
├── .gitignore        ← ป้องกัน key เข้า git
└── README.md         ← ไฟล์นี้
```

---

## ข้อควรระวัง

- ห้ามเก็บ API Key ในไฟล์ที่จะ commit ขึ้น Git
- Key ที่หมดอายุหรือ credit หมด → ขึ้นจุดแดง → ไปเติมเงินที่ [platform.openai.com/billing](https://platform.openai.com/billing)
- Extension ทำงานเฉพาะในเครื่องตัวเอง ไม่มีข้อมูลส่งออกภายนอก (นอกจาก OpenAI API)
