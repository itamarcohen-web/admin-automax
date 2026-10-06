# SECURITY_AUDIT – AutoMax Admin

תאריך: 2026‑10‑06 · היקף: קונסולת ה‑Admin, ה‑Edge Function `admin-api`, מיגרציות ה‑SQL החדשות, והאינטראקציה שלהן עם הסכימה הקיימת
(`AutoMax Models Beta/server/supabase/*.sql`) ועם האתר והאפליקציה.
הבדיקות הרצו מקומית: PostgreSQL 16 אמיתי (181 בדיקות), Edge Function עם תלויות מדומות (119 בדיקות vitest כולל ממשק ובדיקות אבטחה),
`tsc`, ESLint, `deno check`, סריקת סודות, ובדיקה ידנית בדפדפן מול שרת דמה (כניסה, MFA, תפקידים, מובייל).
**לא נבדק** מול פרויקט Supabase חי (אין לי גישה, וכך נכון) – ראו "מה עדיין דורש תשומת לב".

## 1. מה נבדק ומה נמצא

| # | נושא | מה נבדק | ממצא | סטטוס |
|---|---|---|---|---|
| 1 | סודות חשופים | כל קבצי הפרויקט (כולל האפליקציה והאתר), `out/`, `.env*`, JWT‑ים מפוענחים | **לא נמצא סוד בקוד.** מופיע רק `sb_publishable_…` (ציבורי מעצם הגדרתו) באתר ובאפליקציה. אין `service_role`, `sb_secret` או מפתח Resend בשום קובץ | ✔ נקי. נוסף `npm run scan:secrets` (נכשל על סוד) + `prebuild` שמסרב לבנות עם מפתח סודי |
| 2 | `service_role` בדפדפן | `NEXT_PUBLIC_*`, בנדל, localStorage, cookies | הדפדפן מחזיק URL + מפתח ציבורי בלבד. הקוד מסרב לרוץ עם מפתח סודי (`readEnv`). הסשן הוא של Supabase Auth בלבד (לא נוצרו cookies) | ✔ |
| 3 | RLS חסר / מדיניות חלשה | כל הטבלאות הקיימות והחדשות מול תפקידי `anon`/`authenticated` | RLS פעיל בכל הקיימות. כל הטבלאות החדשות: RLS פעיל, **אפס policies**, אפס grants. אין policy מסוג `auth.uid() is not null`. נבדק גם ש"לקוח" לא קורא `talent_grants`, `registration_requests`, `legal_acceptances`, `trial_claims`, `admin_*` ולא כותב `subscriptions`/`payments`/`admin_users` | ✔ |
| 4 | הרשאות RPC | `has_function_privilege` לכל פונקציית `admin_*` | כל 45 הפונקציות: EXECUTE ל‑`service_role` בלבד (revoke מ‑public/anon/authenticated בסוף כל מיגרציה). אימות בייצור: `verify_admin_security.sql` שאילתה 1 | ✔ |
| 5 | הסלמת הרשאות | לקוח → Admin; Admin → super_admin | `admin_users` ללא grant/policy; הוספה רק ב‑SQL Editor או `ADD_ADMIN` (super_admin). אי אפשר לשנות/להשבית את עצמך; טריגר שומר על super_admin פעיל אחד לפחות; תפקיד נבדק גם ב‑Edge וגם בכל פונקציית SQL | ✔ |
| 6 | IDOR | קריאת נתוני משתמש אחר | ללקוחות אין שום נתיב לקונסולה (403, ללא מידע). `p_admin` נלקח תמיד מה‑JWT המאומת; בקשה שמנסה לשלוח `p_admin` נדחית כשדה לא מוכר. ל‑Admin יש גישה לכל המשתמשים **בכוונה** | ✔ |
| 7 | SQL injection | כל הקלט | אין בניית SQL מקלט: פרמטרים בלבד. ה‑SQL הדינמי היחיד (`admin_list_users`) מרכיב רק מילים מ‑allowlist; `ORDER BY` מוזרק רק מטבלת מיפוי; בדיקה עם `sort = "email; drop table …"` – חסר השפעה. `LIKE` מנוטרל (`%`,`_`,`\`) | ✔ |
| 8 | XSS | React, HTML גולמי, CSP | אין `dangerouslySetInnerHTML`/`innerHTML` (ESLint + בדיקה שנכשלת). CSP: `script-src 'self'` בלבד (הסקריפטים הפנימיים של Next מועברים בזמן ה‑build לקבצים חיצוניים; ה‑build נכשל אם נשאר אחד), בלי `unsafe-inline`/`unsafe-eval`; `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `connect-src` רק ל‑Supabase שלכם | ✔ (ראו סעיף 3 לגבי `style-src`) |
| 9 | CSRF | מנגנון האימות | ה‑API מקבל רק `Authorization: Bearer` (אין cookies אוטומטיות) + בדיקת `Origin` + `credentials: 'omit'` ⇒ אין CSRF | ✔ |
| 10 | הרשאה חסרה | כל 39 הפעולות | טבלת פעולות עם תפקיד מינימלי; בדיקות שכל פעולה נדחית מתחת לתפקידה; משתמש לא‑Admin לא יכול אפילו לדעת אילו שמות פעולות קיימים (בדיקת ההרשאה קודמת לבדיקת השם) | ✔ (תוקן במהלך הפיתוח – ראו 2) |
| 11 | PII | מה מוחזר ונרשם | תשובות מוגבלות לעמודות הדרושות, עימוד ≤100. סיסמאות/טוקנים/מפתחות מוסרים אוטומטית מ‑metadata של הביקורת (`admin_scrub`) ולא נרשמים ביומנים; שגיאות לא כוללות SQL, שמות טבלאות או stack | ✔ (קריאות עיון אינן נרשמות – סעיף 3) |
| 12 | חשיפת נתונים עודפת | רשימות ודשבורד | `Active Users` ו‑`Payments` מחושבים במסד (ספירות); אין טעינת טבלאות לדפדפן; חיפוש/סינון/מיון בשרת | ✔ |
| 13 | מחיקה מסוכנת (CASCADE) | כל ה‑FK מול `auth.users` | **`payments` נמחק ב‑CASCADE** עם המשתמש (אובדן היסטוריה פיננסית). `trial_claims`/`talent_grants`/`legal_acceptances` – SET NULL (נשמרים) | ⚠ → ✔ ראו 2 |
| 14 | ביקורת חסרה | כל פעולת כתיבה | כל 25 פעולות הכתיבה כותבות שורת ביקורת **באותה טרנזקציה** כמו הפעולה; פעולות Auth API (יצירה/מחיקה/אימייל/איפוס) נרשמות עם `result`. הטבלה append‑only (גם `service_role` והבעלים נחסמים בטריגר) | ✔ |
| 15 | העלאת קבצים | Releases | הדפדפן מקבל URL העלאה חתום רק מ‑`super_admin`, לנתיב ש**השרת** קובע (`AutoMax-Setup-<version>.exe`), עם פג תוקף של Supabase. ה‑URL להורדה נבנה בשרת, והשרת בודק שהקובץ קיים והגודל תואם; `download_url` שנשלח מהלקוח נדחה. ה‑regex הקיים ב‑`app_releases` נשאר בתוקף | ✔ |
| 16 | ניהול Session | התחברות/התנתקות/פקיעה | סשן רשמי של Supabase (PKCE, רענון אוטומטי); Logout = `signOut(scope: local)` + רישום; פקיעה/401 ⇒ חזרה ל‑login; ניתוק אוטומטי אחרי 30 דקות חוסר פעילות; "Remember session" בוחר localStorage מול sessionStorage; טוקנים לא מועתקים לשום מקום אחר | ✔ |
| 17 | MFA | TOTP רשמי של Supabase | הפעלה/כיבוי ב‑Settings; **אכיפה בשרת**: Admin שרשום לו TOTP מקבל 403 אם ה‑JWT אינו `aal2` – גם אם הדפדפן "דילג" על השלב; `ADMIN_REQUIRE_MFA=true` מחייב רישום; כיבוי דורש סשן `aal2` + הקלדת `DISABLE MFA` | ✔ |
| 18 | Rate limiting / brute force | התחברות, API, פעולות רגישות | API: מונה במסד (לפי Admin ומחלקה): 300/דקה קריאה, 60/דקה כתיבה, 15/10 דקות רגישות; ניסיונות חסומים נרשמים ב‑`ACCESS_DENIED` (מוגבל ל‑20/שעה למשתמש). **התחברות** מוגנת על ידי Rate Limits של Supabase Auth בלבד (אין לי נקודת הרשאה לפני האימות) | ⚠ ראו 3 |
| 19 | כותרות אבטחה | `_headers` | CSP, HSTS, nosniff, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `X-Frame-Options: DENY`, COOP/CORP, `X-Robots-Tag`. נבדק בדפדפן שהאפליקציה פועלת עם ה‑CSP הקפדני (ובדיקת אוטומטית שאין `unsafe-inline` ב‑`script-src`) | ✔ |
| 20 | חסימת חשבון | Disable | נאכף בשרת: דגל `profiles.is_disabled` + Ban ב‑Auth + בדיקה בתוך `check_license` (נבדק על Postgres: חשבון מושבת/חסום מקבל `account_disabled` גם עם מנוי תקף) | ✔ (ראו אזהרת `schema.sql` למטה) |

## 2. מה תוקן / נבנה בעקבות הממצאים

* **`payments` נמחק ב‑CASCADE** – ה‑FK הקיים *לא* שונה (לא לשבור פרודקשן). הוספתי `payments_archive` ו‑`admin_prepare_user_deletion()`: לפני מחיקה, כל התשלומים מועתקים לארכיון (אידמפוטנטי) עם אימייל; המחיקה דורשת `super_admin`, הקלדת `DELETE`, ואסור על Admin פעיל / על עצמך. נבדק על Postgres: 2 תשלומים נעלמו מ‑`payments` ונשארו בארכיון, אישורי התנאים והיומן נשמרו. ה‑UI ממליץ על **Disable** במקום Delete.
* **אין מושג "מושבת" בסכימה הקיימת** – עמודות חדשות ב‑`profiles`, ו‑`check_license` הוגדרה מחדש עם שורת חסימה אחת (שאר הגוף זהה לטקסט המקורי; נבדקו מחדש רישוי פעיל, מגבלת מכשירים, תנאי שימוש, Talent).
* **גילוי שמות פעולות לפני אימות** (תוקן בזמן הפיתוח): בדיקת "פעולה לא מוכרת" הוזזה לאחר האימות וההרשאה.
* **סשן שלא ניתן לפענוח** (תוקן בזמן הפיתוח): כשל בבדיקת רמת ה‑MFA בצד הלקוח גרם לתקיעת מסך הכניסה; כעת הסשן מבוטל וחוזרים ל‑login עם הודעה.
* **התאמת CSP ל‑Next סטטי**: במקום `unsafe-inline`, `scripts/postbuild.mjs` מעביר את הסקריפטים הפנימיים לקבצים חיצוניים, כך שה‑CSP קבוע וזהה ב‑`vercel.json` וב‑`_headers`.
* **חוזה Edge ↔ SQL**: בדיקה אוטומטית שכל פונקציית SQL שהפונקציה קוראת לה קיימת עם שמות פרמטרים זהים (תופסת שגיאות כתיב שהיו מתגלות רק בפרודקשן).
* `admin_audit_log`: אין FK (ההיסטוריה שורדת מחיקת חשבונות), אין UPDATE/DELETE/TRUNCATE.

## 3. מה עדיין דורש תשומת לב

1. **לא נבדק מול Supabase חי.** לפני שימוש: להריץ `verify_admin_security.sql` (9 שאילתות עם תוצאה צפויה לכל אחת), להיכנס עם חשבון לא‑Admin ולוודא 403, ועם Admin ללא MFA/עם MFA. ההתנהגות של `auth.admin.mfa.listFactors` ושל `info()` ב‑Storage מבוססת על ה‑SDK הנוכחי (`@supabase/supabase-js` 2.117) ועברה `deno check`, אך לא רצה מול השרת.
2. **הרצה מחדש של `schema.sql`/`AutoMax-Server-Setup.sql` הישן מחזירה את `check_license` המקורי** (בלי חסימת חשבון). אחריה להריץ שוב `…0200_account_controls.sql`. עד אז ה‑Ban ב‑Auth עדיין חוסם כניסות חדשות ורענון טוקן; רק Access Token שכבר הונפק (עד שעה) ימשיך לעבוד מול `check_license`.
3. **ברוט‑פורס על ההתחברות**: ההגנה היא ה‑Rate Limits של Supabase Auth. מומלץ מאוד: להפעיל CAPTCHA (Turnstile, חינם) ב‑Attack Protection, להפעיל `ADMIN_REQUIRE_MFA=true`, ולשקול **Cloudflare Access** (חינם עד 50 משתמשים) מול `admin.auto-max.co.il` כשכבת כניסה נוספת.
4. **ניסיונות התחברות כושלים** נרשמים רק ביומני Auth של Supabase (לא ב‑`admin_audit_log`), כי אין זהות לפני האימות.
5. **קריאות עיון (צפייה בפרטי לקוח) אינן נרשמות** ביומן הביקורת – רק שינויים. אם נדרש לצרכי פרטיות: להוסיף פעולת `VIEW_USER` ל‑`GET_USER` (שורה אחת ב‑`actions.ts`).
6. **`style-src 'unsafe-inline'`**: ספריית ה‑toast מזריקה `<style>` בזמן ריצה. הסקריפטים קפדניים; סיכון CSS‑injection נמוך אך קיים.
7. **סוד מסד נתונים קיים**: `registration.sql` מציע לשמור את מפתח Resend בטבלה `notification_settings` (מוגנת RLS ובלי grants, והקונסולה אינה קוראת אותה). זה לא נחשף כאן, אבל כל מי שיש לו גישת DB מלאה יכול לקרוא אותו: שקלו להעביר ל‑Vault/Edge Secret ולסובב את המפתח אם הודבק אי‑פעם בצ'אט.
8. **JWT של משתמש/Admin תקף עד שעה** (ברירת מחדל Supabase). השבתת Admin נאכפת מיידית (נבדקת במסד בכל בקשה); אך סשן טוקן של לקוח מושבת נשאר תקף ל‑Auth‑API עד פקיעה. הגדרת Session time‑box/inactivity דורשת תוכנית Pro.
9. **Free tier**: העלאת קבצים עד 50MB; אם המתקין גדול יותר – `tools\publish_release.ps1` ואז "Register uploaded file".
10. **שינוי FK של `payments`** (ל‑`SET NULL`) היה הפתרון הנקי יותר, אך מיגרציה כזו משנה את הסכימה החיה ולכן לא בוצעה אוטומטית. שווה לשקול עם עורך הדין/רואה החשבון.
11. **Extend/Change ידני** יוצר שורת תשלום ב‑0 ₪ עם `provider = manual` (התנהגות `apply_payment`/`grant_by_email` הקיימת) – זה מופיע בעמוד Payments.
12. **Vercel Hobby אינו מיועד לשימוש מסחרי** (תנאי השימוש של Vercel). לשימוש עסקי: Vercel Pro או Cloudflare Pages. ב‑`vercel.json` ה‑`connect-src` הוא `https://*.supabase.co` (רחב מעט מהכתובת המדויקת שב‑Cloudflare).
13. **אין פונקציות Coupons/Refunds/Support Tickets/Feature Flags** – הארכיטקטורה (פעולה = רשומה ב‑`actions.ts` + פונקציית `admin_*`) מוכנה להן.

## 4. רשימת אימות אחרי הפריסה (10 דקות)

1. `verify_admin_security.sql` – כל תוצאה כצפוי.
2. `curl -s -X POST https://<ref>.supabase.co/functions/v1/admin-api -H "content-type: application/json" -d '{"action":"GET_USERS"}'` ⇒ 401.
3. כניסה עם חשבון לקוח רגיל לקונסולה ⇒ "This account does not have administrator access" ובטבלת הביקורת שורת `ACCESS_DENIED`.
4. כניסה כ‑super_admin, הפעלת MFA, התנתקות וכניסה שוב (נדרש קוד).
5. יצירת משתמש בדיקה → Extend → Disable (ובדיקה שהאפליקציה מקבלת `account_disabled`) → Enable → Delete (ובדיקה שהתשלום מופיע ב‑Payments → Archive).
6. `curl -I https://admin.auto-max.co.il` – כל כותרות האבטחה, ו‑`/users/<uuid>/` נטען.
