import { Type, Static } from '@sinclair/typebox';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.LETS_PING_SECRET;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SECRET_KEY) {
    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (!SECRET_KEY) missing.push("LETS_PING_SECRET");
    console.error(`[LetsPing] ❌ Skill Config Error. Missing: ${missing.join(", ")}`);
    throw new Error(`Missing env vars. Did you add them to ~/.openclaw/openclaw.json?`);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    realtime: {
        params: { eventsPerSecond: 10 },
    },
});

const AskParamsSchema = Type.Object({
    tool_name: Type.String({ description: 'The name of the tool (e.g., "stripe_charge").' }),
    args_json: Type.String({ description: 'JSON string of arguments.' }),
    risk_reason: Type.String({ description: 'Why this requires approval.' }),
}, { additionalProperties: false });

type AskParams = Static<typeof AskParamsSchema>;

export const letsping_ask = {
    name: 'letsping_ask',
    description: 'Request human approval (and optional hot-patching) for a high-risk action. Returns the authorized arguments to be used.',
    parameters: AskParamsSchema,
    handler: async (params: AskParams) => {
        let originalArgs;
        try {
            originalArgs = JSON.parse(params.args_json);
        } catch (e) {
            throw new Error(`Invalid 'args_json': Must be a valid JSON string.`);
        }

        const contentHash = crypto.createHash('md5').update(params.tool_name + params.args_json + params.risk_reason).digest('hex');
        const idempotencyKey = `req_${Date.now()}_${contentHash}`;

        console.log(`[LetsPing] 🛡️ Requesting Sudo for: ${params.tool_name}`);

        try {
            const apiRes = await fetch('https://letsping.co/api/openclaw/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SECRET_KEY}`
                },
                body: JSON.stringify({
                    tool: params.tool_name,
                    payload: originalArgs,
                    risk_reason: params.risk_reason,
                    idempotency_key: idempotencyKey
                }),
            });

            if (!apiRes.ok) {
                const errText = await apiRes.text();
                throw new Error(`LetsPing API Error (${apiRes.status}): ${errText}`);
            }

            const { id: requestId } = await apiRes.json();
            console.log(`[LetsPing] 📡 Request ID: ${requestId}. Waiting for Commander...`);

            return new Promise((resolve, reject) => {
                const timeoutMs = 10 * 60 * 1000;
                let isCleanedUp = false;

                const timeoutHandle = setTimeout(() => {
                    if (isCleanedUp) return;
                    cleanup();
                    reject(new Error(`[LetsPing] Timeout: Commander did not respond within 10 minutes.`));
                }, timeoutMs);

                const connectionTimeout = setTimeout(() => {
                    if (isCleanedUp) return;
                    cleanup();
                    reject(new Error(`[LetsPing] Connection Timeout: Could not subscribe to Realtime channel within 5s.`));
                }, 5000);

                const channel = supabase
                    .channel(`request:${requestId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'openclaw_requests',
                            filter: `id=eq.${requestId}`,
                        },
                        (payload) => {
                            const { status, patched_payload } = payload.new;
                            if (status === 'APPROVED') {
                                console.log(`[LetsPing] ✅ APPROVED. Payload: ${patched_payload ? 'PATCHED' : 'ORIGINAL'}`);
                                cleanup();
                                resolve({
                                    status: 'APPROVED',
                                    authorized_payload: patched_payload || originalArgs,
                                });
                            } else if (status === 'REJECTED') {
                                console.log(`[LetsPing] 🚫 REJECTED.`);
                                cleanup();
                                reject(new Error(`[LetsPing] Security Violation: User blocked action '${params.tool_name}'.`));
                            }
                        }
                    )
                    .subscribe((status) => {
                        if (status === 'SUBSCRIBED') {
                            clearTimeout(connectionTimeout);
                        }
                        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            cleanup();
                            reject(new Error(`[LetsPing] Realtime connection failed: ${status}`));
                        }
                    });

                function cleanup() {
                    if (isCleanedUp) return;
                    isCleanedUp = true;
                    clearTimeout(timeoutHandle);
                    clearTimeout(connectionTimeout);
                    supabase.removeChannel(channel);
                }
            });

        } catch (e: any) {
            console.error(`[LetsPing] System Error: ${e.message}`);
            throw e;
        }
    },
};