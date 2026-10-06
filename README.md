# AutoMax Admin

קונסולת הניהול של AutoMax – `https://admin.auto-max.co.il`.
זו שכבת Admin בלבד מעל פרויקט ה‑Supabase הקיים: לא משנה את האפליקציה, את האתר או את מערכת הרישוי, ומשתמשת בפונקציות הקיימות
(`apply_payment`, `grant_talent`, `revoke_talent`, `publish_release`, `publish_legal_document`, `set_registration_status` …).
מבנה, החלטות וההבדלים מול הסכימה: [ARCHITECTURE.md](ARCHITECTURE.md). ביקורת אבטחה: [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

```
דפדפן (Next.js סטטי, מפתח ציבורי בלבד) ── Supabase Auth (+TOTP) ──► Edge Function admin-api ──► public.admin_* (SQL) ──► פונקציות קיימות
                                                                      │ JWT → admin_users → MFA → rate limit → ולידציה → תפקיד
                                                                      └──────────────────────────────────────► admin_audit_log (באותה טרנזקציה)
```

## מה בפנים

| תיקייה | תוכן |
|---|---|
| `src/` | הממשק: Next.js 16 (ייצוא סטטי), TypeScript, Tailwind 4, רכיבים בסגנון shadcn/ui (Radix), Lucide |
| `supabase/migrations/` | 5 מיגרציות (admin_users, audit, rate limit, פעולות, קריאות, אינדקסים) |
| `supabase/functions/admin-api/` | ה‑Edge Function היחידה (`core.ts` = הצינור, `actions.ts` = רשימת הפעולות המותרת) |
| `supabase/manual/` | `add_first_admin.sql`, `verify_admin_security.sql` |
| `supabase/rollback/` | `rollback_admin.sql` |
| `tests/` | `edge/` (Edge Function), `frontend/`, `security/`, `sql/` (Postgres אמיתי), `e2e/mock-supabase.mjs` (שרת דמה) |
| `scripts/` | `postbuild.mjs`, `security-headers.mjs`, `gen-vercel-json.mjs`, `check-env.mjs`, `scan-secrets.mjs`, `serve-out.mjs`, `demo.mjs` |
| `vercel.json`, `.github/` | הגדרות Vercel (כותרות + rewrite) ו‑CI |

## 1. הרצה מקומית

דרישות: Node.js 20 ומעלה (נבדק על 24). Python רק להרצת בדיקות ה‑SQL.

```bash
npm install
```

**לנסות הכול עם נתוני דמה** (בלי Supabase ובלי לגעת בשום דבר אמיתי):

```bash
npm run demo
```

נפתח `http://localhost:3000`. התחברות: `owner@auto-max.co.il` / `Mock-Passw0rd` (super_admin). עוד חשבונות: `ops@` (admin), `help@` (support),
`mfa@` (קוד TOTP `123456`), `customer@example.com` (חשבון תקין שאינו Admin – נדחה).

**מול הפרויקט האמיתי:** העתיקו `.env.example` ל‑`.env.local`, מלאו `NEXT_PUBLIC_SUPABASE_URL` ו‑`NEXT_PUBLIC_SUPABASE_ANON_KEY` (המפתח **הציבורי** `sb_publishable_…`), ואז:

```bash
npm run dev
```

בפיתוח מקומי הוסיפו `http://localhost:3000` ל‑`ADMIN_ALLOWED_ORIGINS` של ה‑Edge Function (ראו סעיף 3) והסירו אותו בסיום.

בדיקות:

```bash
npm run check      # typecheck + lint + 119 בדיקות vitest + סריקת סודות
npm run test:sql   # 181 בדיקות על PostgreSQL אמיתי (pip install pgserver "psycopg[binary]")
npm run build      # בנייה לפרודקשן ל‑out/
```

## 2. הגדרת Supabase (פעם אחת)

1. **הסכימה הקיימת** חייבת להיות מותקנת (`AutoMax-Server-Setup.sql`). המיגרציות בודקות זאת ועוצרות אם חסר.
2. **מיגרציות** – ב‑Supabase → SQL Editor, להריץ לפי הסדר (כל אחת בטוחה להרצה חוזרת):
   `20261006000100_admin_core.sql` → `…0200_account_controls.sql` → `…0300_admin_actions.sql` → `…0400_admin_reads.sql` → `…0500_admin_indexes.sql`.
   אפשר גם `npx supabase link --project-ref <project-ref>` ואז `npx supabase db push`.
   `<project-ref>` הוא החלק הראשון של כתובת הפרויקט (`https://<project-ref>.supabase.co`).
3. **אימות** – להריץ את `supabase/manual/verify_admin_security.sql`. כל שאילתה מציינת מעליה את התוצאה הנדרשת. אם אחת שונה – לעצור.
4. **Auth** (Dashboard → Authentication):
   * *Sign In / Providers → Multi Factor*: ודאו ש‑TOTP פעיל (Enroll + Verify).
   * *URL Configuration*: ה‑Site URL ו‑Redirect URLs לפי האתר שלכם (ל"איפוס סיסמה" שהקונסולה שולחת).
   * *Attack Protection*: מומלץ להפעיל CAPTCHA (Cloudflare Turnstile – חינם) נגד ניחוש סיסמאות. *Rate Limits*: להשאיר ברירת מחדל או להקשיח.
   * *Password requirements*: מינימום 10 תווים. *SMTP*: שולח משלכם (מייל איפוס הסיסמה יוצא ממנו).
5. **Storage**: ה‑bucket `releases` קיים כבר (נוצר ב‑`schema.sql`). ב‑Free יש מגבלה של 50MB לקובץ.

## 3. משתני סביבה

| משתנה | איפה | משמעות |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | build של הממשק | כתובת הפרויקט – ציבורי |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build של הממשק | **מפתח ציבורי בלבד** (`sb_publishable_…`). הקוד מסרב לרוץ עם `service_role`/`sb_secret_` |
| `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` | build | התנתקות אחרי חוסר פעילות (ברירת מחדל 30) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Function | **מוזרקים אוטומטית** על ידי Supabase. לעולם לא בדפדפן/Git |
| `ADMIN_SERVICE_KEY` | Edge Function (אופציונלי) | מפתח `sb_secret_…` במקום ה‑service_role הישן |
| `ADMIN_ALLOWED_ORIGINS` | Edge Function | מקורות מותרים ל‑CORS, ברירת מחדל `https://admin.auto-max.co.il` |
| `ADMIN_REQUIRE_MFA` | Edge Function | `true` = כל Admin חייב TOTP (מומלץ אחרי שהגדרתם את שלכם) |
| `PASSWORD_RESET_REDIRECT` | Edge Function | לאן מגיע הלינק במייל "איפוס סיסמה" |
| `RELEASE_MAX_BYTES` | Edge Function | מגבלת ההעלאה של התוכנית שלכם (ברירת מחדל 52428800) |

פריסת הפונקציה והגדרת סודות:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase secrets set ADMIN_ALLOWED_ORIGINS=https://admin.auto-max.co.il PASSWORD_RESET_REDIRECT=https://auto-max.co.il/account
npx supabase functions deploy admin-api
```

## 4. יצירת ה‑Admin הראשון

1. ודאו שיש חשבון **מאושר** עם האימייל שלכם (Authentication → Users → Add user עם "Auto Confirm User", או הרשמה רגילה).
2. פתחו את `supabase/manual/add_first_admin.sql`, החליפו את `PUT-THE-ADMIN-EMAIL-HERE` באימייל שלכם והריצו ב‑SQL Editor.
   אין שם UUID מזויף: הסקריפט מסרב לרוץ עד שמחליפים, ומוצא את ה‑user id לבד. (אם אתם מעדיפים UUID:
   `insert into public.admin_users(user_id, role) values ('<ה‑id שלכם>', 'super_admin');`)
3. היכנסו ל‑`https://admin.auto-max.co.il`, ועברו ל‑**Settings → Enable two-factor**.
4. אחרי שה‑MFA פועל: `npx supabase secrets set ADMIN_REQUIRE_MFA=true`.

## 5. GitHub + Vercel

> **שימו לב:** התוכנית החינמית של Vercel (Hobby) מיועדת לשימוש **לא מסחרי** בלבד לפי תנאי השימוש שלהם. AutoMax הוא מוצר מסחרי, ולכן לשימוש עסקי צריך Vercel Pro (בתשלום).
> אם חשוב לכם חינם לגמרי ומותר מסחרית – Cloudflare Pages (סעיף 5ב). הקוד תומך בשניהם.

### העלאה ל‑GitHub

```bash
git init -b main
git add .
git status          # תוודאו שאין .env.local, out/, node_modules/ (כולם ב‑.gitignore)
git commit -m "AutoMax Admin"
git remote add origin https://github.com/<user>/automax-admin.git
git push -u origin main
```

מומלץ **Private repository**. `npm run scan:secrets` מריץ בדיקה שאין מפתח סודי בקבצים; ה‑CI (`.github/workflows/ci.yml`) מריץ typecheck, lint, בדיקות, build וסריקת סודות על כל push.
אל תעלו `.env.local`, ואל תכניסו `service_role` לשום משתנה של Vercel/GitHub – הוא קיים רק כסוד של ה‑Edge Function ב‑Supabase.

### פריסה ב‑Vercel

1. vercel.com → **Add New → Project** → Import של ה‑repo. Framework: **Next.js** (מזוהה לבד; `vercel.json` כבר מגדיר Build Command, `npm ci` ו‑Output Directory `out`).
2. **Environment Variables** (Production + Preview) – רק שניים:
   * `NEXT_PUBLIC_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   * `NEXT_PUBLIC_SUPABASE_ANON_KEY` = המפתח **הציבורי** `sb_publishable_…`
   ה‑build נעצר בכוונה אם חסר משתנה או אם הוזן מפתח סודי (`scripts/check-env.mjs`).
3. Deploy. הכותרות (CSP קפדני, HSTS וכו') וה‑rewrite של `/users/<id>` מגיעים מ‑`vercel.json`.
4. אחרי כל שינוי ב‑`scripts/security-headers.mjs` להריץ `npm run vercel-json` ולעשות commit (בדיקה אוטומטית נכשלת אם הקבצים לא תואמים).
5. ב‑Supabase להגדיר `ADMIN_ALLOWED_ORIGINS=https://admin.auto-max.co.il` (וכתובת ה‑Preview אם רוצים לבדוק אותה: `https://<project>.vercel.app`).

ה‑CSP ב‑`vercel.json` מתיר חיבור ל‑`https://*.supabase.co` (Vercel לא יכול לקרוא את כתובת הפרויקט בזמן build); ב‑Cloudflare מוגבל לכתובת המדויקת של הפרויקט שלכם.

### 5ב. חלופה: Cloudflare Pages (חינם, מותר לשימוש מסחרי)

```bash
npm run build
npx wrangler login
npx wrangler pages deploy out --project-name automax-admin
```

(או Connect to Git: Build command `npm run build`, Output `out`, אותם שני משתנים + `NODE_VERSION=22`.) `npm run build` יוצר ב‑`out/` את `_headers` ו‑`_redirects` ש‑Cloudflare קורא.

## 6. חיבור `admin.auto-max.co.il` (DNS ב‑Vangus)

**Vercel:** Project → **Settings → Domains → Add** → `admin.auto-max.co.il`. Vercel יציג את הרשומה המדויקת. בדרך כלל:

| שדה | ערך |
|---|---|
| Type | `CNAME` |
| Name / Host | `admin` |
| Value / Target | הערך ש‑Vercel מציג (למשל `cname.vercel-dns.com` או `<מזהה>.vercel-dns-0xx.com`) – בדיוק כפי שמופיע |
| TTL | אוטומטי / 300 |

אם Vercel מציג בנוסף רשומת אימות (`TXT`) – להוסיף אותה כפי שהיא. ההנפקה של תעודת HTTPS אוטומטית (דקות עד שעה). אל תשנו את הרשומות הקיימות של האתר (`auto-max.co.il`, `www`, MX).

**Cloudflare Pages:** Custom domains → `admin.auto-max.co.il` → הרשומה: `CNAME admin → <project>.pages.dev` (כפי שמוצג שם).

בדיקה: `curl -I https://admin.auto-max.co.il` – 200 וכל כותרות האבטחה; ופתיחת `/users/<uuid>/` טוענת את העמוד.

## 7. הוספת Admin

*super_admin* נכנס ל‑**Settings → Administrators → Add admin**, מזין אימייל של חשבון **מאושר** ובוחר תפקיד:
`support` (קריאה + מכשירים + סטטוס הרשמות), `admin` (פעולות תפעוליות + יומן), `super_admin` (הכול, כולל מחיקות, גרסאות, מסמכים משפטיים וניהול Admins).
או ב‑SQL: `supabase/manual/add_first_admin.sql`. כל שינוי נרשם כ‑`ADMIN_PERMISSION_CHANGE`.

## 8. ביטול Admin

**Settings → Administrators → Change → Deactivated** (נכנס לתוקף בבקשה הבאה, ללא מטמון). או:
`update public.admin_users set is_active = false where user_id = (select id from auth.users where email = '…');`
אי אפשר להוריד/למחוק את ה‑super_admin הפעיל האחרון (טריגר במסד הנתונים).

## 9. עבודה עם ה‑Edge Function

* **הוספת פעולה:** רשומה חדשה ב‑`actions.ts` (תפקיד מינימלי, מחלקת rate limit, `parse` קפדני, `run` שקורא ל‑`public.admin_*`) + פונקציית SQL במיגרציה חדשה.
  בדיקת החוזה (`tests/edge/contract.test.ts`) נכשלת אם שם הפונקציה/הפרמטרים אינם תואמים ל‑SQL.
* **בדיקה בלי Supabase:** `npm test` (הצינור כולו עם תלויות מדומות). בדיקת טיפוסים של נקודת הכניסה: `cd supabase/functions/admin-api && npx deno check index.ts`.
* **לוגים:** Dashboard → Edge Functions → admin-api → Logs. נרשמים רק פעולה, קוד סטטוס ומזהה משתמש – לעולם לא טוקנים, סיסמאות או גוף הבקשה.
* **פריסה:** `npx supabase functions deploy admin-api` (הגדרת `verify_jwt = true` ב‑`supabase/config.toml`).

## 10. מיגרציות

קובץ חדש ב‑`supabase/migrations/<timestamp>_<name>.sql`, אידמפוטנטי, שמסתיים בבלוק ההרשאות (revoke מ‑`anon`/`authenticated`, grant ל‑`service_role`) כמו בקיימות.
בדיקה לפני פרודקשן: `npm run test:sql` מריץ את הסכימה הקיימת + כל המיגרציות על PostgreSQL אמיתי (פעמיים) ובודק הרשאות, RLS, ביקורת והתנהגות.
**חשוב:** הרצה מחודשת של `schema.sql` הישן מחזירה את `check_license` למצבו הקודם (בלי חסימת חשבון מושבת) – להריץ אחריה שוב את `…0200_account_controls.sql`
(`verify_admin_security.sql` שאילתה 7 מראה אם החסימה פעילה).

## 11. Rollback

* **ממשק:** Vercel → Deployments → ‏⋯ → Promote to Production על פריסה קודמת (ב‑Cloudflare: Deployments → Rollback).
* **Edge Function:** פריסה מחדש של גרסה קודמת מה‑Git (`supabase functions deploy admin-api`), או השבתה: מחיקת הפונקציה מה‑Dashboard (הממשק יפסיק לעבוד, שום דבר אחר לא ייפגע).
* **מסד נתונים:** `supabase/rollback/rollback_admin.sql` מסיר את פונקציות `admin_*`, `admin_users`, `admin_rate_limits` והאינדקסים. הוא **משאיר בכוונה**
  את `admin_audit_log`, `payments_archive` ואת עמודות `profiles.is_disabled` (ראיות והיסטוריה פיננסית). להחזרת `check_license` המקורי – הרצת `schema.sql`.

## 12. הערות אבטחה (תמצית)

* בדפדפן יש רק `URL` ומפתח ציבורי. `service_role` קיים רק כסוד של ה‑Edge Function. `npm run scan:secrets` (וכשל בבדיקות) תופס מפתח סודי, JWT של service_role ומפתח Resend.
* כל בקשה: JWT → `admin_users` (פעיל + תפקיד) → MFA (אם רשום TOTP – חובה `aal2`) → rate limit בצד שרת → ולידציה קפדנית (שדה לא מוכר נדחה) → תפקיד → SQL שבודק שוב הרשאה וכותב ביקורת באותה טרנזקציה.
* רשימת פעולות סגורה; פעולה לא מוכרת = 400 (ולא‑Admin מקבל 403 בלי לדעת אילו פעולות קיימות).
* `admin_audit_log` הוא append‑only גם למנהל המסד (טריגרים) ואין לו מסך עריכה/מחיקה. סיסמאות/טוקנים/מפתחות מנוקים אוטומטית מה‑metadata.
* מחיקת משתמש = `super_admin` + הקלדת `DELETE` + ארכוב התשלומים לפני המחיקה (`payments` נמחק ב‑CASCADE במבנה הקיים). עדיף **Disable**.
* ה‑CSP מאפשר סקריפטים מ‑`self` בלבד: שני הסקריפטים הפנימיים של Next מועברים בזמן ה‑build לקבצים חיצוניים (`/_next/static/inline/*.js`), ו‑build נכשל אם נשאר סקריפט פנימי. הדפדפן חוסם כל סקריפט שיוזרק.
* מה שעדיין דורש פעולה שלכם מפורט בסוף [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
"# automax-admin" 
"# admin-automax" 
"# admin-automax" 
