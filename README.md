# PNUtify

Every CSE and International notice at Pusan National University in one place, your deadlines, and a daily briefing. Made by a PNU student for PNU students. **No account and no PLATO password.**

Live at **https://www.pnutify.app**. Add it to your home screen to use it like an app.

## Features

- **Briefing:** today at a glance. It shows overdue tasks, today's and this week's deadlines, a 7-day load strip, and the notices that are new since your last visit.
- **Notices:** the CSE (정보컴퓨터공학부), International (국제처) and university-wide (부산대학교 공지사항) boards, merged and de-duplicated, with search, unread filter, "New" and "Pinned" badges, mark-all-read and share. Each student picks which boards to show (Settings → Boards), and notices open inside the app with their attachments.
- **Tasks:** your own assignments and exams with due dates in KST, grouped into Overdue, Today, This week and Later.
- **Calendar:** a month view of your deadlines.
- **Alerts:** web push for new CSE or International notices, usually within a minute or two of posting, and reminders 24 hours and 1 hour before a task is due. Each category can be turned on or off on its own, and you can send yourself a test alert.
- **Sync across devices:** no account needed. Settings → Sync across devices gives a code to enter on your other device; tasks and read notices then stay the same on both. The server keeps the shared copy under a hash of the code, never the code itself.
- **Weekly preview:** an optional alert on Sunday at 8 pm (Korea time) with the coming week's deadlines, day by day.
- Installable PWA with 5 themes, including a dark Night theme.

## How it works

```
cron, every minute (cron-job.org; GitHub Actions and Vercel Cron as backups)
   │  GET /api/push/send   Authorization: Bearer $CRON_SECRET
   ▼
check page 1 of both boards ── nothing new ──► done (1 request per board, ~5 Redis commands)
   │ new post, or 30 min since the last full read
   ▼
read every page ──► Redis snapshot "notices:latest" ◄── GET /api/notices (every visitor)
   │
   └─► new notices + due tasks ──► web push ──► open app refreshes at once
```

- **How fast alerts arrive.** The university boards can't notify anyone, so PNUtify checks them. Every run reads only page 1 of each board, which is enough to spot a new post. A new post triggers a full read and the push right away, so with a one-minute schedule an alert arrives about 1–2 minutes after posting. Every 30 minutes all pages are re-read anyway, to pick up edits and removals.
- **Light on the university servers.** One request per board per minute, about what one student refreshing the page would cause.
- **Light on Redis.** A run with nothing new uses about 5 Redis commands, and device data is read in one batch. Checking every minute fits the Upstash free tier.
- Visitors read one shared snapshot from Redis, so page views never hit the university servers. An open app refreshes every minute, and immediately when a push arrives.
- The board lists cut long titles off (60 characters on International, 50 on CSE) without an ellipsis. Those titles are completed from the article page and remembered, so lists and alerts show the full title.
- On a first visit, notices that aren't new are marked read, so a new student sees the handful of new notices instead of 100+ unread ones.
- Each notice gets a stable id: the article number, or a hash of title and date when there is none. Pinned posts are taken from page 1 only. Paging stops when a board repeats a page. Together these remove the duplicate notices.
- If a board is down, its last known notices are kept, so they don't vanish and later come back as "new".
- A notice is pushed at most once, and only while it's fresh (seen in the last day, posted in the last 3). Overlapping cron calls are locked out.
- When there are more than 3 new notices at once, a device gets one summary push instead of a flood.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in:
   - Create a free [Upstash Redis](https://upstash.com) database for `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
   - Run `npx web-push generate-vapid-keys`. Put the public key in **both** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PUBLIC_KEY`, and the private key in `VAPID_PRIVATE_KEY`.
   - Set `CRON_SECRET` to a long random string (`openssl rand -hex 32`).
3. `npm run dev`

On Vercel, add the same variables under **Project → Settings → Environment Variables**.

### Scheduling the notice check

The endpoint is `GET` or `POST https://www.pnutify.app/api/push/send` with the header `Authorization: Bearer <CRON_SECRET>`. Alerts are only as fast as this schedule, so set up one main trigger that runs **every minute**:

- **cron-job.org (recommended, free, allows every minute):**
  1. Sign up at cron-job.org and choose **Create cronjob**.
  2. URL: `https://www.pnutify.app/api/push/send`. Schedule: every 1 minute.
  3. Under **Advanced → Headers**, add `Authorization` with the value `Bearer <CRON_SECRET>`.
  4. Turn on failure notifications, so you hear about it if the site stops answering.
  5. Save, then use **Test run**. The response should be JSON with `"ok": true`.
- **Upstash QStash** also works (Console → QStash → Schedules, same URL and header). Check its free-tier daily message limit first: every minute is 1,440 calls a day, so you may need every 2 minutes.

The endpoint takes a lock, so overlapping calls are safe and never send the same alert twice.

Two backups are included and safe to run alongside the main trigger:

- `.github/workflows/check-notices.yml` runs every 15 minutes. It needs the repo secrets `CRON_SECRET` and `APP_DOMAIN` (`www.pnutify.app`). GitHub delays scheduled runs and pauses them after 60 days without commits, which is why it shouldn't be the only trigger. It also **fails, and GitHub emails you, when a board has been unreadable for 3+ hours**. That usually means the university changed its page layout and `src/lib/scrapeNotices.ts` needs updating.
- `vercel.json` adds a once-a-day Vercel Cron, the limit on the free plan.

### Owner mode: PLATO and NESPA (for the site owner only)

PNUtify can show **your own** PLATO deadlines and course announcements, and NESPA assignments, scores and notices. These appear in the Briefing, Tasks and Calendar and in reminders. No other visitor can see or use them.

1. In Vercel, add these environment variables (mark them **Sensitive**), then redeploy:
   - `OWNER_SECRET`: a long random key (`openssl rand -hex 32`, 32+ characters)
   - `PLATO_ID`, `PLATO_PW`: your PLATO login
   - `NESPA_ID`, `NESPA_PW` (optional): your NESPA login. Without it you still get NESPA deadlines and notices, but not scores.
2. On each of your devices: **Settings → Owner sign-in** (small link at the bottom), then paste `OWNER_SECRET`.
3. Optional: turn on **PLATO & NESPA posts** under Alerts.

How it's kept private:
- Your logins exist only in Vercel's environment variables, never in a browser or in Redis.
- PLATO is read through Moodle's mobile API. One login gives an access key, which is stored **encrypted** in Redis and reused, so your password isn't sent again until the key expires. The NESPA session cookie is also stored encrypted.
- An owner device holds an `httpOnly` cookie derived from `OWNER_SECRET`. Everyone else gets `401` from `/api/owner/*`. After 10 wrong keys, unlocking pauses for 15 minutes. Changing `OWNER_SECRET` signs every device out.
- If PLATO or NESPA rejects the stored password, PNUtify waits 6 hours before trying again, so a wrong password can't get your account locked.
- PLATO and NESPA are read every 20 minutes at most, or when you press **Sync now**.
- Your tasks, read notices and PLATO/NESPA "done" ticks sync between your owner devices.

### Alerts on iPhone

iOS only allows web push for sites added to the home screen (iOS 16.4+). The app explains this in Settings and shows the steps.

## Privacy

- PNUtify never asks for a university login. Older versions stored a PLATO login in the browser; this version deletes it on first load.
- Tasks and read history stay in the browser, unless you turn on sync. Then a copy is stored under a hash of your sync code; anyone with the code can read and change it, so it shouldn't be shared.
- When deadline reminders are on, only the title, course and due time of upcoming tasks are sent to the server, so it can send the reminders. Turning reminders off clears that copy.

## Tests

```bash
npm test
```

- `src/lib/__tests__/scrapeNotices.test.ts` runs the parser against saved copies of both real boards (`src/lib/__tests__/fixtures/`). When a board changes its layout, save the new page there and fix the parser until the tests pass.
- `src/lib/__tests__/push.test.ts` runs the alert cycle against an in-memory Redis. It checks that each notice is pushed once and reminders aren't repeated, and that a quiet run stays cheap.

Browser tests (Playwright, phone and desktop layouts) run against the production build:

```bash
npm run build
npm run test:e2e
```

They live in `e2e/`. The app's API calls are answered with test data, so they never touch the university sites, Redis or push services. One test calls the real server to check that owner data is refused to visitors.

CI runs lint, unit tests, the build and the browser tests on every pull request.

## Contributing

Issues and pull requests are welcome. Run `npx eslint src`, `npm test` and `npm run build` before opening one.
