## Setup

First, install [Bun](https://bun.sh). You can install it by running:

```bash
curl -fsSL https://bun.sh/install | bash
```

Or follow the [official installation guide](https://bun.sh/docs/installation).

Clone the repo.

```bash
git clone https://github.com/holonym-foundation/phone-number-server.git
```

Install dependencies with bun.

```bash
bun install
```

Set environment variables. You might need to contact the team to get the values of some of these variables.

```bash
cp .env.example .env
```

Run redis on localhost:6379. You can do this with redis-server OR docker. The docker command might be different depending on your OS.

```bash
# redis-server
redis-server

# docker
docker run -p 6379:6379 redis
```

Run the development server.

```bash
bun run start
```

Or simply:

```bash
bun check-number.js
```

## Contributing

**Git practices**

We use a style of Gitflow.

- All changes should be pushed to the `dev` branch.
- If a feature takes a while (e.g., weeks) to implement, prefer creating a feature branch. Once the feature is finished, rebase onto `dev`.
- The `main` branch is protected. PRs to `main` can only be merged by authorized individuals. PRs to `main` are only merged from `dev`.

**Linting and formatting**

All commits must pass linting and formatting checks.

Run these commands prior to each commit:

```bash
# bun run lint-fix
bun run format-fix
```
