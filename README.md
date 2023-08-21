## Setup

First, install Node.js 16. We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage your Node.js versions.

Clone the repo.

```bash
git clone https://github.com/holonym-foundation/phone-number-server.git
```

Install dependencies with npm.

```bash
npm install
```

Set environment variables. You might need to contact the team to get the values of some of these variables.

```bash
cp .env.example .env
```

Run redis on localhost:6379. You can do this with redis-server OR docker.

```bash
# redis-server
redis-server

# Docker
docker run -p 6379:6379 redis
```

Run the development server.

```bash
npm run start
```
