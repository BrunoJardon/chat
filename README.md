# Chat Self-Hosted

A private, self-hosted chat application for personal use — built as a full-stack showcase of modular architecture, secure authentication, and real-time messaging.

## Overview

Chat Self-Hosted is a private messaging platform you run yourself, keeping your conversations in your own infrastructure. The backend is fully implemented: account creation, JWT sessions, private conversations, persistent message history, and real-time events over Socket.IO.

The Next.js app is currently the default scaffold. Authentication screens, the API client, room views, and the chat UI are the next milestone.

## Features

- **Authentication** — email/password registration and login with argon2id password hashing.
- **JWT sessions** — short-lived access tokens, refresh tokens, refresh rotation, and replay protection.
- **Session management** — per-device sessions with IP address, user agent, login and logout timestamps.
- **User profiles** — own profile and public user profiles.
- **Private rooms** — idempotent 1:1 conversation creation and server-side membership checks.
- **Persistent messages** — message history stored in PostgreSQL with cursor-based pagination.
- **Real-time messaging** — Socket.IO events for joining rooms, sending messages, typing indicators, and presence.
- **Presence** — online/offline status and last-seen timestamps backed by Redis, including cleanup of stale sockets.
- **Health checks** — database and Redis readiness exposed through the API.
- **API documentation** — Swagger UI available outside production.

## Tech Stack

| Layer                   | Technology                                       |
| ----------------------- | ------------------------------------------------ |
| Frontend                | Next.js 16, React 19, Tailwind CSS 4             |
| Backend                 | NestJS 12                                        |
| Database                | PostgreSQL 17                                    |
| Cache / ephemeral state | Redis 8                                          |
| ORM                     | Prisma 7                                         |
| Real-time               | Socket.IO                                        |
| Authentication          | JWT with `jose`, argon2id with `@node-rs/argon2` |
| Testing                 | Vitest, Supertest, Socket.IO client              |
| Tooling                 | pnpm workspaces, ESLint, OxLint, Prettier, Husky |
| Infrastructure          | Docker Compose                                   |

## Architecture

### Monorepo layout

```text
.
├── apps/
│   ├── api/                 # NestJS API
│   └── web/                 # Next.js frontend (in progress)
├── packages/
│   ├── database/            # Prisma schema, migrations, generated client
│   ├── types/               # Shared REST and Socket.IO contracts
│   └── utils/               # Pure shared helpers
├── docker-compose.yml       # PostgreSQL + Redis
├── pnpm-workspace.yaml
└── package.json
```

### Backend

The API is a **modular monolith**. Each feature owns its module and exposes only what other features need:

```text
apps/api/src/
├── main.ts / app.module.ts
├── config/                  # Environment validation
├── core/
│   ├── database/            # Global Prisma module
│   ├── redis/               # Global Redis module
│   └── health/              # Readiness checks
└── modules/
    ├── auth/                # Register, login, refresh, logout, guards
    ├── users/               # Profiles
    ├── rooms/               # 1:1 conversations
    ├── messages/            # Persistent history
    └── gateway/             # Socket.IO real-time layer
```

Within each feature the flow is **Controller → Service → Prisma**. Business logic lives in services; controllers stay thin. The Socket.IO gateway reuses the same services instead of duplicating message or room logic.

### Data responsibilities

- **PostgreSQL** is the source of truth: users, rooms, messages, and session history.
- **Redis** stores ephemeral state: socket-to-user mappings, presence, last-seen timestamps, and consumed refresh-token identifiers.
- **`packages/types`** is the shared kernel: REST contracts and Socket.IO event payloads used by both applications.
- **`packages/database`** owns the Prisma schema, migrations, and generated client. The API consumes it through a `PRISMA_CLIENT` provider.

## Getting Started

### Prerequisites

- Node.js 24 (see `.nvmrc`)
- pnpm 12.3.4
- Docker with Docker Compose

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure the environment

```bash
cp .env.example .env
```

Generate the JWT secrets with at least 32 characters:

```bash
openssl rand -base64 32
```

Fill in `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and the database/Redis credentials in `.env`.

### 3. Start PostgreSQL and Redis

```bash
docker compose up -d postgres redis
```

### 4. Build the shared packages

The API resolves workspace packages from their `dist/` output, so build them before starting the API on a fresh checkout:

```bash
pnpm --filter @chat/database build
pnpm --filter @chat/types build
pnpm --filter @chat/utils build
```

`@chat/database` also generates the Prisma client during this step.

### 5. Apply migrations

```bash
pnpm --filter @chat/database prisma:migrate
```

For an existing database, use `pnpm --filter @chat/database prisma:deploy` instead.

### 6. Start the applications

```bash
pnpm run dev
```

Once both are running:

- API: `http://localhost:3000/api`
- Swagger UI: `http://localhost:3000/api/docs`
- Health check: `http://localhost:3000/api/health`
- Web: `http://localhost:3001`

## Environment Variables

| Variable             | Purpose                                              | Default     |
| -------------------- | ---------------------------------------------------- | ----------- |
| `NODE_ENV`           | Runtime environment (`dev`, `prod`, `test`)          | `dev`       |
| `API_HOST`           | API bind host                                        | `localhost` |
| `API_PORT`           | API port                                             | `3000`      |
| `WEB_HOST`           | Reserved for the web app                             | `localhost` |
| `WEB_PORT`           | Reserved; not consumed yet                           | `3001`      |
| `JWT_ACCESS_SECRET`  | Access-token signing secret (minimum 32 characters)  | —           |
| `JWT_REFRESH_SECRET` | Refresh-token signing secret (minimum 32 characters) | —           |
| `JWT_ACCESS_TTL`     | Access-token lifetime                                | `15m`       |
| `JWT_REFRESH_TTL`    | Refresh-token lifetime                               | `7d`        |
| `DATABASE_URL`       | Prisma connection string                             | —           |
| `DB_HOST`            | PostgreSQL host used by Docker Compose               | `localhost` |
| `DB_PORT`            | PostgreSQL port                                      | `5432`      |
| `DB_USER`            | PostgreSQL user                                      | `chat`      |
| `DB_PASSWORD`        | PostgreSQL password                                  | —           |
| `DB_NAME`            | PostgreSQL database                                  | `chat`      |
| `REDIS_HOST`         | Redis host                                           | `localhost` |
| `REDIS_PORT`         | Redis port                                           | `6379`      |
| `REDIS_PASSWORD`     | Redis password                                       | —           |

## API Overview

All routes below are prefixed with `/api`. Except for the auth routes and the health check, requests require an `Authorization: Bearer <accessToken>` header.

| Method  | Endpoint                  | Description                                    |
| ------- | ------------------------- | ---------------------------------------------- |
| `POST`  | `/auth/register`          | Create an account and return a token pair      |
| `POST`  | `/auth/login`             | Authenticate and return a token pair           |
| `POST`  | `/auth/refresh`           | Rotate a refresh token and issue a new pair    |
| `POST`  | `/auth/logout`            | Revoke the refresh token and close the session |
| `GET`   | `/users/me`               | Get the authenticated user's profile           |
| `PATCH` | `/users/me`               | Update the authenticated user's display name   |
| `GET`   | `/users/:id`              | Get another user's public profile              |
| `POST`  | `/rooms`                  | Create or reuse a 1:1 conversation             |
| `GET`   | `/rooms`                  | List the authenticated user's conversations    |
| `GET`   | `/rooms/:roomId`          | Get conversation details (members only)        |
| `POST`  | `/rooms/:roomId/messages` | Create a message                               |
| `GET`   | `/rooms/:roomId/messages` | List message history with cursor pagination    |
| `GET`   | `/health`                 | Check PostgreSQL and Redis readiness           |

Message pagination accepts `before=<messageId>` and `limit` (1–50).

## Real-time Events

Connect to the Socket.IO server using the API host and port. Authenticate the handshake with the access token in either `auth.token` or the `token` header:

```ts
io("http://localhost:3000", {
  auth: { token: accessToken },
});
```

### Client → server

| Event          | Payload                |
| -------------- | ---------------------- |
| `room:join`    | `{ roomId }`           |
| `room:leave`   | `{ roomId }`           |
| `message:send` | `{ roomId, content }`  |
| `typing:set`   | `{ roomId, isTyping }` |

### Server → client

| Event             | Payload                        |
| ----------------- | ------------------------------ |
| `message:new`     | `{ message }`                  |
| `typing:update`   | `{ roomId, userId, isTyping }` |
| `presence:update` | `{ userId, status, lastSeen }` |
| `event:error`     | `{ code }`                     |

Room membership is validated by the server before a socket can join a room or send a message.

## Testing

The API uses Vitest. Unit tests cover services, controllers, guards, the gateway, and presence logic. End-to-end tests exercise the HTTP API and Socket.IO flows with Supertest and a real Socket.IO client.

```bash
# Unit tests
pnpm --filter api test

# End-to-end tests (requires PostgreSQL and Redis)
pnpm --filter api test:e2e
```

Notes:

- Start PostgreSQL and Redis, and provide a valid root `.env`, before running the e2e suite.
- E2E tests run against the local development database and create records with unique email addresses. They are not isolated from development data yet.
- The root `pnpm test` command runs unit tests only; it does not include e2e tests.
- `apps/web` does not have a test runner yet. Use `pnpm --filter web typecheck`, `pnpm --filter web lint`, and `pnpm --filter web build`.

Run the full quality pipeline with:

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm test
```

## Current Limitations

This is an MVP under active development, not a production-hardened deployment:

- [ ] Logout immediately revokes the refresh token and closes the session, but the access token remains valid until it expires.
- [ ] CORS is permissive for local development and still needs environment-based configuration.
- [ ] Concurrent creation of the same 1:1 conversation can create duplicates because uniqueness is not enforced by the database.
- [ ] Cursor pagination does not yet validate that the cursor belongs to the requested room.
- [ ] The Next.js frontend and full application containerization are pending.

## Roadmap

1. **Frontend** — authentication screens, session handling, room list, chat view, and Socket.IO client.
2. **Stabilization** — configurable CORS, access-token revocation, unique 1:1 conversations, cursor validation, and WebSocket error handling.
3. **Product flows** — contacts, groups, read/unread state, and logout behavior for connected sockets.
4. **Deployment** — containerize the API and web app, document a complete local deployment, and verify persistence across restarts.

## License

This project is licensed under the MIT License.
