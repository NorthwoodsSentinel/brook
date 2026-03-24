# Brook — Fleet Overwatch

A sleeping guardian for multi-agent AI fleets.

I was running three Claude Code instances across two machines. None of them knew what the others had built. I searched for something I'd made and couldn't find it — and for a moment I wondered if I'd made it up.

That's a workflow problem with a psychological cost. Brook fixes it.

## What it does

Brook is a Cloudflare Durable Object that wakes up every hour, scans your GitHub repos, reads your fleet-bridge registry, checks for drift, and goes back to sleep. It costs less than a dollar a month. It costs nothing when idle.

When something needs your attention, Brook knows. When an agent needs to know what another agent built, Brook knows. When you switch between AI instances mid-thought, Brook holds the context so you don't have to re-explain yourself.

## What it watches

- **Git repos** — new repos, large commits, unexpected pushes, commit volume
- **Fleet-bridge** — shared registry of what each agent built, when, where
- **Agent status** — who's online, what they're working on, when they last checked in
- **Drift** — if no agent has updated in 24 hours, something's wrong

## What it does NOT do

- No AI inference. Pure logic — thresholds, diffs, pattern matching.
- No content judgment. Tracks activity, not meaning.
- No action. Observer only. Never pushes code or instructs agents.

## Architecture

```
┌──────────────────────────────────────────┐
│         BROOK (Durable Object)           │
│                                          │
│   SQLite DB (persistent):                │
│   - repos: known repos + last commit     │
│   - agents: who's online, doing what     │
│   - agent_registry: what was built       │
│   - alerts: unread alerts                │
│   - checks: scan history                 │
│                                          │
│   Wakes on:                              │
│   - Cron (hourly)                        │
│   - GitHub webhook (on push)             │
│   - Manual /check request                │
│   - Agent /checkin or /publish           │
│                                          │
│   Sleeps between. Costs nothing.         │
└──────────────────────────────────────────┘
```

## Endpoints

### Public (no auth)
| Endpoint | Description |
|----------|-------------|
| `/` | Service info |
| `/daemon` | Fleet overview page (human-readable) |
| `/daemon/:agent` | Per-agent daemon page |

### Private (Bearer token required)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Fleet health snapshot |
| `/check` | GET | Force an immediate scan |
| `/alerts` | GET | Unread alerts |
| `/silence?id=X` | GET | Dismiss an alert |
| `/webhook` | POST | GitHub push trigger |
| `/history` | GET | Last 24 checks |
| `/fleet` | GET | All agents with status |
| `/agent/:name` | GET | One agent's full state + registry |
| `/checkin` | POST | Agent reports online + working_on |
| `/checkout` | POST | Agent reports offline |
| `/publish` | POST | Agent publishes what it built |

## Deploy in 5 minutes

### Prerequisites
- Cloudflare account (free tier works)
- GitHub personal access token (classic, `repo` + `read:org` scope)
- Node.js + npm

### Steps

```bash
git clone https://github.com/NorthwoodsSentinel/brook.git
cd brook
npm install

# Edit wrangler.toml — set GITHUB_ORG to your org
# Then:

npx wrangler deploy

# Set secrets:
echo "your-github-token" | npx wrangler secret put GITHUB_TOKEN
echo "your-api-key-here" | npx wrangler secret put BROOK_API_KEY

# Generate an API key:
openssl rand -hex 32
```

Brook is now live at `https://brook.your-subdomain.workers.dev`.

### First check
```bash
curl https://your-brook-url/check \
  -H "Authorization: Bearer your-api-key"
```

Brook scans all repos, establishes its baseline, and starts watching.

### Wire your agents

At session start, each agent checks in:
```bash
curl -X POST https://your-brook-url/checkin \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "agent-name", "machine": "hostname", "working_on": "current task"}'
```

When an agent builds something, it publishes:
```bash
curl -X POST https://your-brook-url/publish \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent-name",
    "items": [
      {"what": "built a thing", "location": "/path/to/thing", "status": "deployed"}
    ]
  }'
```

Any agent can query any other agent:
```bash
curl https://your-brook-url/agent/other-agent \
  -H "Authorization: Bearer your-api-key"
```

## The problem this solves

If you run multiple AI coding assistants — Claude Code instances, Cursor, Copilot Workspace, or any combination — you have a fragmentation problem. Each instance has its own context. None of them know what the others built. You become the relay, the clipboard, the postal service between your own tools.

Brook gives your fleet self-awareness. Not intelligence — awareness. The difference between "I don't know what you're talking about" and "Archie built that at 2pm, it's on the main branch."

## Cost

- Cloudflare Workers Paid plan: $5/month
- Durable Objects: ~$0.00/month at this scale (720 requests/month for hourly cron)
- Total: under $1/month on top of your existing Workers plan

## What's next

- GitHub webhook integration for real-time push monitoring
- Fleet-bridge registry parsing for fragmentation detection
- Biometric correlation layer (Garmin/Oura integration)
- MCP server endpoint for AI-native fleet queries

## License

MIT

## Origin

Built in one afternoon by a security architect who was running three AI agents and almost had a panic attack because none of them could find what he'd built that morning. The problem wasn't the tools. It was the architecture. Brook is the fix.
