# Project overview

This is a Lovable-generated TanStack Start application for an AI oral-interview simulator. It uses React, TypeScript, Tailwind CSS, TanStack Router/Start, Supabase, and server-side AI integrations.

## Running locally or in Lovable

The existing project structure and Lovable-managed Vite configuration should be preserved. The standard local command remains:

```sh
npm install
npm run dev
```

## Running on Replit

Replit uses the committed Bun lockfile and the `Start application` workflow:

```sh
bun install --frozen-lockfile
bun run dev -- --host 0.0.0.0 --port 5000
```

The workflow serves the web preview on port 5000 and does not replace the Lovable development setup.

## Environment requirements

The Supabase URL and publishable key are required for authentication and database-backed features. The server-side interview and speech features also use:

- `CEREBRAS_API_KEY_1`
- `CEREBRAS_API_KEY_2`
- `CEREBRAS_API_KEY_3`
- `GROQ_API_KEY_1`
- `GROQ_API_KEY_2`

Keep these values in the environment/secrets manager rather than committing them. The public Supabase values may continue to be supplied through Lovable's connected environment or the existing `.env` configuration.

## Verification

`bun run build` completes successfully. The root page is available through the Replit preview and renders without browser console errors.