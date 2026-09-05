# ðŸ“± SplitSettle AI

**Scan bills with AI. Split fairly. Settle in the fewest payments.**

A mobile-first **PWA** (installable, Add-to-Home-Screen) built with **Next.js 14 + TypeScript + Tailwind + shadcn/ui**, backed by **Supabase Postgres + Prisma**, with **Gemini** vision OCR, a **minimum-transaction settlement algorithm**, and **Razorpay test-mode payment links** with a live webhook.

> The headline: instead of naive pairwise refunds, SplitSettle computes each person's net balance and greedily matches the largest debtor to the largest creditor â€” collapsing an O(nÂ²) debt graph into at most nâˆ’1 real payments. The UI shows the "before â†’ after" so judges can see it.

---

## âœ¨ Features

| # | Feature | Where |
|---|---------|-------|
| 1 | Quick login (name + phone, session cookie) | `/login` |
| 2 | Create/join groups via 6-char share code | `/groups` |
| 3 | **Scan Bill** â€” Gemini Vision extracts vendor, total, items, date; animated confirm card | `/scan` |
| 4 | Equal / custom / **by-item** split, multi-payer | Split editor |
| 5 | **Minimum-transaction settlement** with beforeâ†’after graph | Group detail |
| 6 | Razorpay payment links + **signed webhook** â†’ live "Paid" status | `/api/webhooks/razorpay` |
| 7 | Activity feed (transaction-style, avatars, pull-to-refresh) | `/activity` |
| 8 | **AI Spending Coach** chat grounded in real DB data (never invents numbers) | Group detail |
| 9 | **Auto-categorization** (Food/Travel/Rent/Utilities/Shopping) with colored chips | Scan flow |
| 10 | **Anomaly detection** â€” "40% above usual" warning before confirming | Scan flow |
| 11 | **Smart reminders** â€” Gemini-written nudges, tone scales gentleâ†’firm with age | Group detail |
| 12 | **Monthly recap** shareable card | Group detail |
| 13 | **Fair-split forecast** â€” "at this rate you'll owe ~â‚¹X by month end" | `/home` |

Everything degrades gracefully: no Gemini key â†’ manual entry + keyword categories + template insights. No Razorpay keys â†’ mock payment links. The app is always demoable.

---

## ðŸ—ï¸ Architecture

```mermaid
graph TB
    subgraph Phone["ðŸ“± PWA (Next.js 14 App Router, Vercel)"]
        UI["Bottom-tab UI: Home Â· Groups Â· Scan Â· Activity Â· Profile"]
        SW["Service Worker + manifest: offline shell, installable"]
    end

    subgraph API["âš¡ Next.js Route Handlers"]
        OCR["/api/ocr"]
        SETTLE["/api/settlement"]
        LINKS["/api/payment-links"]
        WEBHOOK["/api/webhooks/razorpay"]
        CHAT["/api/chat Â· /api/insights Â· /api/reminders"]
    end

    subgraph Ext["External services"]
        GEM["Google Gemini (vision OCR + text: scan, chat, insights)"]
        RZP["Razorpay Test Mode payment links"]
    end

    DB[("Supabase Postgres<br/>Prisma ORM")]

    UI --> API
    OCR --> GEM
    CHAT --> GEM
    LINKS --> RZP
    RZP -- "payment_link.paid (HMAC-SHA256 signed)" --> WEBHOOK
    API --> DB
```

**Settlement engine** (`lib/settlement-algorithm.ts`): net balance per person â†’ sort creditors/debtors by magnitude â†’ greedily settle largest-vs-largest â†’ at most nâˆ’1 transfers.

## ðŸš€ Run locally (5 minutes)

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env        # then paste your keys (table below)

# 3. Create the database schema
npx prisma db push

# 4. Run
npm run dev                 # â†’ http://localhost:3000
```

Open it on your phone via your LAN IP (e.g. `http://192.168.x.x:3000`) for the real native-app feel, and use your browser's **"Add to Home Screen"** to install it.

### Environment variables

| Variable | Where to get it | Required? |
|----------|----------------|-----------|
| `DATABASE_URL` | Supabase â†’ Project Settings â†’ Database â†’ Connection string (URI) | âœ… |
| `SESSION_SECRET` | Any long random string (`openssl rand -hex 32`) | âœ… |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) â€” free tier | Recommended |
| `GEMINI_MODEL` | Defaults to `gemini-1.5-flash` | Optional |

| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay Dashboard â†’ Settings â†’ API Keys â†’ **Test mode** (`rzp_test_â€¦`) | For real links |
| `RAZORPAY_WEBHOOK_SECRET` | You choose it when creating the webhook (see below) | For live settling |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally, your Vercel URL in prod | âœ… |

> No keys at all? The app still runs: OCR falls back to a manual form, categories come from a keyword classifier, and payment links are simulated. Great for UI rehearsal.

## 📧 Automatic email reminders (Gmail App Password)

The instant a bill is split and payment links are generated, the server **automatically** emails every debtor — no button click needed. Each email is written by Gemini (tone scales with how overdue the debt is: gentle on day 1, firmer by day 5+), formatted as clean HTML with the group name, exact amount owed and a **Pay Now** button linking to the Razorpay payment link.

**How it works:**
- Sent via **Nodemailer (Gmail SMTP)** from **one dedicated app account** — no per-user Google login, no OAuth consent screen, no test-user list. It works immediately for **any** recipient email address.
- Delivery is tracked per debt (`EmailLog`): the group screen shows "✅ Emailed" / "❌ Failed to send" with the reason.

**Setup (5 minutes, no Google Cloud Console):**
1. Create one Gmail account for the app (e.g. `splitsettleai.notify@gmail.com`) — or use your own. A dedicated one keeps your personal inbox separate and looks professional in the "From" name.
2. On that account: **Google Account → Security → 2-Step Verification** — turn it on (App Passwords require it).
3. Go to **[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)** → generate an App Password (app type: **Mail**) → copy the 16-character password (not your regular Gmail password).
4. Add the env vars:

| Variable | Value |
|----------|-------|
| `NOTIFICATION_EMAIL` | The dedicated Gmail address (e.g. `splitsettleai.notify@gmail.com`) |
| `NOTIFICATION_EMAIL_APP_PASSWORD` | The 16-character App Password |

5. Add the same two vars in **Vercel → Settings → Environment Variables** for production.

> Tip: the first one or two sends from a brand-new account may land in the recipient's **Spam** folder — check there when testing.

**Not configured?** Nothing breaks — the app falls back to showing the same personalized nudge inside the group screen with a "Copy message" button so you can send it manually.

---

## â˜ï¸ Deploy to Vercel + Supabase
1. **Supabase** (free): create a project â†’ copy the **Connection string (URI)**.
2. **Push this repo to your GitHub.**
3. **Vercel**: "New Project" â†’ import the repo â†’ add the env vars from the table above (use Supabase's **connection pooling** URI, port `6543`, for `DATABASE_URL`).
4. Deploy. Then create the DB schema once from your machine:
   ```bash
   DATABASE_URL="<your-supabase-uri>" npx prisma db push
   ```
5. **Razorpay webhook**: Dashboard â†’ Settings â†’ Webhooks â†’ add `https://<your-app>.vercel.app/api/webhooks/razorpay`, subscribe to **`payment_link.paid`**, set a secret â†’ paste the same secret as `RAZORPAY_WEBHOOK_SECRET` in Vercel â†’ redeploy.

Every `git push` to `main` now redeploys automatically. No other manual steps.

---

## ðŸ§ª Demo script (90 seconds that win)

1. Scan a real receipt â†’ watch Gemini extract vendor/items/date and the fields animate in.
2. Notice the anomaly chip on a big bill ("60% above usual").
3. Assign payers, save â†’ activity feed updates.
4. Open **Settle up** â†’ the beforeâ†’after graph shows 9 possible payments collapsing to 2.
5. Tap "Create payment links" â†’ real Razorpay test links; pay one on your phone â†’ webhook flips it to âœ… live.
6. Ask the AI Coach "how much did we spend on food this month?" â€” grounded, real numbers.
7. Show the monthly recap card and the fair-split forecast.

---

## ðŸ“ Structure

```
app/
  (tabs)/            home Â· groups Â· scan Â· activity Â· profile (bottom-nav shell)
  api/               ocr Â· bills Â· settlement Â· payment-links Â· webhooks/razorpay Â· chat Â· insights Â· reminders Â· activity Â· groups Â· session
components/          bottom-nav Â· bottom-sheet Â· chat-sheet Â· recap-card Â· settlement-graph Â· screens/* Â· ui/*
lib/                 prisma Â· gemini Â· razorpay Â· settlement-algorithm Â· categorize Â· insights Â· session Â· api
prisma/schema.prisma User Â· Group Â· Membership Â· Bill Â· BillShare Â· Debt Â· Activity
public/              manifest.json Â· sw.js Â· icons
```

## ðŸ› ï¸ Tech stack

Next.js 14 (App Router) Â· TypeScript Â· Tailwind CSS Â· shadcn/ui patterns Â· Framer Motion Â· lucide-react Â· Prisma + Supabase Postgres Â· Google Gemini (`@google/generative-ai`) Â· Razorpay Node SDK (test mode) Â· next-themes (dark mode) Â· PWA manifest + service worker.


