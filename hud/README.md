This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Telegram Notifications (Desktop + Phone)

Telegram delivery reaches both desktop and phone automatically if both are logged in to the same account/chat.

### Environment

Set these in your environment:

- `TELEGRAM_BOT_TOKEN` (required)
- `TELEGRAM_CHAT_IDS` (optional comma-separated default recipients)

### API

- `POST /api/notifications/trigger`
  - body: `{ "message": "Hello from Nova", "chatIds": ["123456"] }`
- `GET /api/notifications/schedules`
- `POST /api/notifications/schedules`
  - body: `{ "label": "Daily Standup", "message": "Standup time", "time": "09:30", "timezone": "America/New_York", "enabled": true }`
- `PATCH /api/notifications/schedules`
  - body includes `id`, e.g. `{ "id": "schedule-id", "enabled": false }`
- `DELETE /api/notifications/schedules?id=schedule-id`
- `POST /api/notifications/scheduler` to start scheduler loop
- `DELETE /api/notifications/scheduler` to stop scheduler loop

Scheduler checks every 30 seconds and sends once per local day per schedule.

## Supabase Google OAuth Setup

For Google sign-in with Supabase Auth:

1. In Supabase Dashboard -> Authentication -> Providers -> Google, set Google `Client ID` and `Client Secret`.
2. In Google Cloud Console (OAuth client), add this authorized redirect URI:

```text
https://jmxkjhsmdqlpjvcleifm.supabase.co/auth/v1/callback
```

Notes:
- Do not use the Supabase callback URL as the app `redirectTo` in client code.
- Client code should continue to use app URLs (for this project: `/login?...`) so users return to Nova after auth.

### Scriptable CLI

Use:

```bash
npm run notify:send -- --message "Nova check-in"
```

Optional recipients override:

```bash
npm run notify:send -- --message "Nova check-in" --chatIds "123456,789012"
```

## Mission Web Search Behavior

- Mission web research uses Tavily as the primary data provider.
- Mission output now humanizes structured search payloads into readable bullet summaries.
- If AI returns structured JSON-like web results, runtime converts it to plain-language bullets plus source links before delivery.
