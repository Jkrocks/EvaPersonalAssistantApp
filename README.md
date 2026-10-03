# Eva

A personal assistant web app: chat, voice, tasks and a memory that learns.

- `index.html` is the whole app. It is served by GitHub Pages.
- `supabase/functions/eva-brain` is her brain. It runs on Supabase and calls Claude with the `ANTHROPIC_API_KEY` secret.
- Sign-in is Supabase Auth (email, Google, Apple, phone). Eva is invite-only: an account gets in only if its email or phone is listed in the `eva_allowed` table.
