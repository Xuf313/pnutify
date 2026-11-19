# PNUtify

Every CSE and International notice at Pusan National University in one place, your deadlines, and a daily briefing. Made by a PNU student for PNU students. **No account and no PLATO password.**

Live at **https://www.pnutify.app**. Add it to your home screen to use it like an app.

## Features

- **Briefing:** today at a glance. It shows overdue tasks, today's and this week's deadlines, a 7-day load strip, and the notices that are new since your last visit.
- **Notices:** the CSE (정보컴퓨터공학부) and International (국제처) boards, merged and de-duplicated, with search, unread filter, "New" and "Pinned" badges, mark-all-read and share.
- **Tasks:** your own assignments and exams with due dates in KST, grouped into Overdue, Today, This week and Later.
- **Calendar:** a month view of your deadlines.
- **Alerts:** web push for new CSE or International notices, and reminders 24 hours and 1 hour before a task is due. Each category can be turned on or off on its own, and you can send yourself a test alert.
- Installable PWA with 5 themes, including a dark Night theme.

## How it works

```
cron (QStash / cron-job.org / GitHub Actions / Vercel Cron)
   │  GET /api/push/send   Authorization: Bearer $CRON_SECRET
   ▼
scrape both boards ──► Redis snapshot "notices:latest" ◄── GET /api/notices (every visitor)
   │
   └─► new notices + due tasks ──► web push to subscribed devices
```

- Visitors read one shared snapshot from Redis, so page views never hit the university servers.
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

The endpoint is `GET` or `POST https://www.pnutify.app/api/push/send` with the header `Authorization: Bearer <CRON_SECRET>`. Pick one main trigger that runs every 5–10 minutes:

- **Upstash QStash (recommended, same account as Redis):** go to Console → QStash → Schedules → Create. Set the destination to `https://www.pnutify.app/api/push/send`, the cron to `*/10 * * * *`, and the header to `Authorization: Bearer <CRON_SECRET>`.
- **cron-job.org (free):** create a job with the same URL, every 10 minutes, and the same header under Advanced → Headers.

Two backups are included and safe to run alongside the main trigger:

- `.github/workflows/check-notices.yml` runs every 15 minutes. It needs the repo secrets `CRON_SECRET` and `APP_DOMAIN` (`www.pnutify.app`). GitHub delays scheduled runs and pauses them after 60 days without commits, which is why it shouldn't be the only trigger.
- `vercel.json` adds a once-a-day Vercel Cron, the limit on the free plan.

### Alerts on iPhone

iOS only allows web push for sites added to the home screen (iOS 16.4+). The app explains this in Settings and shows the steps.

## Privacy

- PNUtify never asks for a university login. Older versions stored a PLATO login in the browser; this version deletes it on first load.
- Tasks and read history stay in the browser.
- When deadline reminders are on, only the title, course and due time of upcoming tasks are sent to the server, so it can send the reminders. Turning reminders off clears that copy.

## Contributing

Issues and pull requests are welcome. Run `npx eslint src` and `npm run build` before opening one.
