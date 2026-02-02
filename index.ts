import { Type, Static } from '@sinclair/typebox';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = "https://tqphlqmmamdjoufqnnka.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxcGhscW1tYW1kam91ZnFubmthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMjIzNjksImV4cCI6MjA4NDY5ODM2OX0.N3EU5ovNeeh6pkJsi_emHuMFm5vAguC3qR0S4Qq5K14";
const SECRET_KEY = process.env.LETS_PING_SECRET;

if (!SECRET_KEY) {
    throw new Error("[LetsPing] Missing LETS_PING_SECRET env var. Cannot initialize OpenClaw skill.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    realtime: {
        params: { eventsPerSecond: 10 },
    },
});


let cachedKey: crypto.webcrypto.CryptoKey | null = null;

async function getKey(): Promise<crypto.webcrypto.CryptoKey> {
    if (cachedKey) return cachedKey;

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(SECRET_KEY),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );

    cachedKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: encoder.encode("openclaw-salt"),
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );

    return cachedKey;
}

async function encryptPayload(payload: any): Promise<string> {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();

    const dataStr = JSON.stringify(payload);
    const encoded = encoder.encode(dataStr);

    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoded
    );

    const ivStr = Buffer.from(iv).toString('base64');
    const cipherStr = Buffer.from(ciphertext).toString('base64');

    return `${ivStr}:${cipherStr}`;
}

async function decryptPayload(encryptedStr: string): Promise<any> {
    if (!encryptedStr.includes(":")) return JSON.parse(encryptedStr);

    const [ivStr, dataStr] = encryptedStr.split(":");
    const key = await getKey();

    const iv = Buffer.from(ivStr, 'base64');
    const data = Buffer.from(dataStr, 'base64');

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        data
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
}


const AskParamsSchema = Type.Object({
    tool_name: Type.String({ description: 'The name of the tool being gated (e.g., "stripe_charge").' }),
    args_json: Type.String({ description: 'The JSON string of arguments to be approved.' }),
    risk_reason: Type.String({ description: 'The reason why this action requires human approval.' }),
}, { additionalProperties: false });

type AskParams = Static<typeof AskParamsSchema>;

export const letsping_ask = {
    name: 'letsping_ask',
    description: 'Request human approval for a high-risk action. Returns the authorized (and potentially human-modified) arguments.',
    parameters: AskParamsSchema,
    handler: async (params: AskParams) => {
        let originalArgs;
        try {
            originalArgs = JSON.parse(params.args_json);
        } catch (e) {
            throw new Error(`Invalid 'args_json': Must be a valid JSON string.`);
        }

        console.log(`[LetsPing] 🔒 Encrypting payload for: ${params.tool_name}`);
        const encryptedPayload = await encryptPayload(originalArgs);
        const idempotencyKey = `req_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

        console.log(`[LetsPing] 🛡️ Requesting Authorization...`);

        try {
            const apiRes = await fetch('https://letsping.co/api/openclaw/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SECRET_KEY}`
                },
                body: JSON.stringify({
                    tool: params.tool_name,
                    payload: encryptedPayload,
                    risk_reason: params.risk_reason,
                    idempotency_key: idempotencyKey
                }),
            });

            if (!apiRes.ok) {
                const errText = await apiRes.text();
                throw new Error(`LetsPing API Error (${apiRes.status}): ${errText}`);
            }

            const { id: requestId, status } = await apiRes.json();

            // Fast Path: Auto-Approved logic (if applicable in future)
            if (status !== 'PENDING') {
                return { status, authorized_payload: originalArgs };
            }

            console.log(`[LetsPing] 📡 Request ID: ${requestId}. Waiting for Commander...`);

            return new Promise((resolve, reject) => {
                const timeoutMs = 10 * 60 * 1000; // 10 Minutes
                let isCleanedUp = false;

                const timeoutHandle = setTimeout(() => {
                    cleanup();
                    reject(new Error(`[LetsPing] Timeout: Commander did not respond within 10 minutes.`));
                }, timeoutMs);

                const channel = supabase.channel(`req-${requestId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'openclaw_requests',
                            filter: `id=eq.${requestId}`,
                        },
                        async (payload) => {
                            const { status, patched_payload } = payload.new;

                            if (status === 'PENDING') return;

                            cleanup();

                            if (status === 'APPROVED') {
                                console.log(`[LetsPing] ✅ APPROVED.`);
                                let finalPayload = originalArgs;

                                if (patched_payload) {
                                    try {
                                        console.log(`[LetsPing] 🔓 Decrypting patched instructions...`);
                                        finalPayload = await decryptPayload(patched_payload);
                                    } catch (e) {
                                        reject(new Error(`[LetsPing] Decryption Failed: Could not read commander's instructions.`));
                                        return;
                                    }
                                }

                                resolve({
                                    status: 'APPROVED',
                                    authorized_payload: finalPayload,
                                });
                            } else {
                                console.log(`[LetsPing] 🚫 REJECTED.`);
                                reject(new Error(`[LetsPing] Security Violation: User blocked action '${params.tool_name}'.`));
                            }
                        }
                    )
                    .subscribe((status) => {
                        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            cleanup();
                            reject(new Error(`[LetsPing] Realtime connection failed: ${status}`));
                        }
                    });

                function cleanup() {
                    if (isCleanedUp) return;
                    isCleanedUp = true;
                    clearTimeout(timeoutHandle);
                    supabase.removeChannel(channel);
                }
            });

        } catch (e: any) {
            console.error(`[LetsPing] System Error: ${e.message}`);
            throw e;
        }
    },
};