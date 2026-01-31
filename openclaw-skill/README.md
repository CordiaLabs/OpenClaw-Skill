# LetsPing OpenClaw Skill 🛡️

Prompt-based HITL approval for high-risk OpenClaw agent actions. The agent calls `letsping_ask` before destructive, financial, social, or infra changes. You review/edit/reject via mobile PWA.

**Important**: Escalation is enforced via prompt engineering, not runtime interception. Strong models (Claude Opus, GPT-4o+) follow reliably (~90-95% on well-tested prompts). Always verify in a sandbox.

## Features
- `letsping_ask(tool_name, args_json, risk_reason)` — blocks until approval.
- Realtime Supabase wait (10-minute default timeout).
- Hot-patching: Edit JSON payload before approving.
- Idempotency to avoid duplicate alerts.
- No runtime patching — pure skill + prompt.

## Installation

1. **Clone the skill**
   ```bash
   git clone https://github.com/CordiaLabs/openclaw-skill ~/.openclaw/workspace/skills/letsping
   ```

2. **Install dependencies**
   ```bash
   cd ~/.openclaw/workspace/skills/letsping
   npm install
   ```

3. **Configure environment**
   Add to `~/.openclaw/openclaw.json` (or export manually):
   ```json
   {
     "skills": {
       "entries": {
         "letsping": {
           "env": {
             "SUPABASE_URL": "https://your-project.supabase.co",
             "SUPABASE_ANON_KEY": "your-anon-key",
             "LETS_PING_SECRET": "sk_live_..."
           }
         }
       }
     }
   }
   ```
   Get your `LETS_PING_SECRET` by pairing at https://letsping.co/openclaw/pair

   Restart the OpenClaw gateway after changes.

4. **Teach the agent**
   Copy the prompt snippet from `SKILL.md` into your workspace `TOOLS.md` or `AGENTS.md`. This defines when the agent must escalate.

## How It Works

**Agent task**: "Redeploy to production with force flag"

**Agent reasoning** (with good prompt):
  > Risk: infrastructure change → call letsping_ask

**You receive notification**:
  > vercel_deploy  
  > Reason: Infra change  
  > Payload: `{ "env": "production", "force": true }`

**Options**:
  - Approve as-is
  - Edit payload (e.g., set `"force": false`)
  - Reject → agent receives error and aborts/replans

## Limitations & Tips
- Escalation depends on model + prompt quality. Test high-risk scenarios thoroughly.
- Realtime wait is fragile across daemon restarts (Upstash durability planned).
- Timeout defaults to 10 minutes → agent errors out.
- Use sandbox sessions for initial testing.

## Troubleshooting
- Skill not loading? Check gateway logs: `openclaw gateway --log-level debug`
- Agent skipping calls? Add more few-shot examples to the prompt.
- No notifications? Verify pairing and push permissions in the PWA.

Feedback → letsping.co