import { Type, Static } from '@sinclair/typebox';
import { LetsPing, computeDiff } from '@letsping/sdk';

const SECRET_KEY = process.env.LETSPING_API_KEY;

if (!SECRET_KEY) {
    throw new Error("[LetsPing] Missing LETSPING_API_KEY env var. Cannot initialize OpenClaw skill.");
}

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

        console.log(`[LetsPing] Requesting Authorization for: ${params.tool_name}`);

        const result = await lp.ask({
            service: "openclaw-agent",
            action: params.tool_name,
            payload: originalArgs,
            priority: "high",
        });

        if (result.status === "APPROVED" || result.status === "APPROVED_WITH_MODIFICATIONS") {
            console.log(`[LetsPing] APPROVED.`);

            if (result.patched_payload) {
                const diff = computeDiff(result.payload, result.patched_payload);
                const diff_summary = diff ? { changes: diff } : { changes: "Unknown structure changes" };
                return {
                    status: 'APPROVED_WITH_MODIFICATIONS',
                    diff_summary,
                    original_payload: result.payload,
                    executed_payload: result.patched_payload
                };
            }

            return {
                status: 'APPROVED',
                executed_payload: result.payload
            };
        } else {
            console.log(`[LetsPing] REJECTED.`);
            throw new Error(`[LetsPing] Security Violation: User blocked action '${params.tool_name}'.`);
        }
    },
};