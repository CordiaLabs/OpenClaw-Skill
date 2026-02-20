import { Type, Static } from '@sinclair/typebox';
import { LetsPing } from '@letsping/sdk';

const SECRET_KEY = process.env.LETS_PING_SECRET;

if (!SECRET_KEY) {
    throw new Error("[LetsPing] Missing LETS_PING_SECRET env var. Cannot initialize OpenClaw skill.");
}

// Initialize SDK
const lp = new LetsPing(SECRET_KEY);

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

        console.log(`[LetsPing] 🛡️ Requesting Authorization for: ${params.tool_name}`);

        try {
            // Use the SDK to ask for approval
            // Service = "openclaw-agent"
            // Action = tool_name
            const result = await lp.ask({
                service: "openclaw-agent",
                action: params.tool_name,
                payload: originalArgs,
                priority: "high", // Default to high for agent blocks
                // We pass risk_reason in metadata for visibility in custom potential future columns?
                // Currently standard SDK doesn't support explicit 'risk_reason' param.
            });

            if (result.status === "APPROVED") {
                console.log(`[LetsPing] ✅ APPROVED.`);
                return {
                    status: 'APPROVED',
                    authorized_payload: result.patched_payload || result.payload
                };
            } else {
                console.log(`[LetsPing] 🚫 REJECTED.`);
                throw new Error(`[LetsPing] Security Violation: User blocked action '${params.tool_name}'.`);
            }

        } catch (e: any) {
            throw e;
        }
    },
};