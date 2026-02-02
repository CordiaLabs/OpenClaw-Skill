# LetsPing OpenClaw Skill

Human-in-the-loop approval tool for OpenClaw agents.

The skill adds `letsping_ask(tool_name, args_json, risk_reason)`, which pauses execution of high-risk actions until a human approves, rejects, or edits the payload via the LetsPing dashboard.

Payloads are encrypted client-side using AES-GCM with the pairing secret. The relay server and database store only ciphertext.

## Installation

Clone into your OpenClaw workspace:

```bash
git clone https://github.com/letsping/openclaw-skill ~/.openclaw/workspace/skills/letsping
```

Install dependencies:

```bash
cd ~/.openclaw/workspace/skills/letsping
npm install
```

Restart the OpenClaw gateway.

## Configuration

Add to `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "letsping": {
        "env": {
          "SUPABASE_URL": "https://tqphlqmmamdjoufqnnka.supabase.co",
          "SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxcGhscW1tYW1kam91ZnFubmthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMjIzNjksImV4cCI6MjA4NDY5ODM2OX0.N3EU5ovNeeh6pkJsi_emHuMFm5vAguC3qR0S4Qq5K14",
          "LETS_PING_SECRET": "lp_live_..."
        }
      }
    }
  }
}
```

Obtain `LETS_PING_SECRET` by pairing at https://letsping.co/openclaw/pair.

## Usage

Add the following to your agent's system prompt or `AGENTS.md`:

```
You have full authority for safe actions: reading files, logs, web searches, data analysis without side effects.

You MUST call letsping_ask BEFORE any high-risk action. NEVER execute high-risk actions directly.

High-risk includes:
- Financial: Spending money, bookings, transactions > $10
- Destructive: Delete/overwrite files, DB rows, configs
- Social: Posting, sending DMs/emails to new/public contacts
- Infrastructure: Modifying DNS, env vars, deployments, infra APIs

Provide:
- tool_name: exact tool name
- args_json: stringified JSON of arguments
- risk_reason: clear justification

After call:
- APPROVED: Use ONLY authorized_payload (may be patched)
- REJECTED or timeout: Abort, retry safely, or ask for guidance

Example:
letsping_ask(tool_name: "vercel_deploy", args_json: "{\"project\":\"my-app\",\"env\":\"production\",\"force\":true}", risk_reason: "Production deployment with force flag")
```

## Security Model

Payloads are encrypted on the agent using AES-GCM derived from `LETS_PING_SECRET`. Only ciphertext is sent to the relay and stored in Supabase. Decryption occurs solely on paired devices using the same secret from local storage.

The relay cannot read payloads.

## How It Works

1. Agent calls `letsping_ask` for a high risk action.
2. Skill encrypts payload locally and sends ciphertext to relay.
3. Relay stores request and notifies paired device.
4. Human reviews (decrypts), optionally edits, then approves/rejects.
5. On approval, relay returns patched ciphertext (or original).
6. Agent decrypts and resumes with authorized payload.

Default timeout: 10 minutes.

## Troubleshooting

- Skill not loading: Check gateway logs (`openclaw gateway --log-level debug`). Ensure `npm install` succeeded.
- Agent skips call: Use strong models (Claude Opus, GPT-4o). Add more prompt examples.
- No notifications: Verify pairing and browser permissions.
- Timeout errors: Agent should handle gracefully.

Issues/PRs: https://github.com/cordialabs/openclaw-skill

https://letsping.co