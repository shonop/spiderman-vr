# VR Game

משחק VR שבנוי על WebXR + Three.js + Vite. רץ בדפדפן של ה-Quest או על המחשב דרך Quest Link.

## הפעלה

```bash
npm install
npm run dev
```

השרת עולה ב-HTTPS על פורט 5173.

### בקווסט (Wi-Fi)
1. המחשב והקווסט צריכים להיות על אותה רשת.
2. בדפדפן של הקווסט פותחים את הכתובת `Network` שמופיעה בטרמינל, למשל `https://192.168.1.20:5173`.
3. מופיעה אזהרה על התעודה (זו תעודה מקומית לפיתוח) → Advanced → Proceed.
4. לוחצים **ENTER VR**.

### במחשב דרך Quest Link / Air Link
פותחים את `https://localhost:5173` ב-Chrome או ב-Edge, ומוודאים ש-Meta Horizon Link מוגדר כ-OpenXR runtime.

### בלי משקפת
פותחים את `https://localhost:5173`, ומסתכלים מסביב עם גרירה של העכבר.
כדי לדמות משקפת ובקרים אפשר להתקין את התוסף **Immersive Web Emulator** של Meta ל-Chrome.

## שליטה ב-VR
| כפתור | פעולה |
|---|---|
| טריגר | תפיסה ושחרור של חפץ |
| סטיק שמאלי | הליכה |
| סטיק ימני | סיבוב בקפיצות של 30° |

## מבנה
- `src/main.js` – ה-renderer, המצלמה, ה-rig של השחקן והלולאה הראשית
- `src/world.js` – הסביבה (תאורה, רצפה, שולחן) והחפצים שאפשר לתפוס
- `src/controllers.js` – הבקרים: קרן הצבעה, תפיסה ותנועה
- `public/` – קבצים סטטיים (מודלים מסוג `.glb`, סאונדים, טקסטורות)

## Build
```bash
npm run build
```
התוצאה נכנסת ל-`dist/` ואפשר להעלות אותה לכל אחסון סטטי עם HTTPS (GitHub Pages, Netlify, Vercel).
