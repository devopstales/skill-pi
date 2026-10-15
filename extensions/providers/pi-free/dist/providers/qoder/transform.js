/**
 * Message format transformation between Pi's internal format and Qoder's
 * proprietary API format.
 *
 * Pi uses a structured message format with typed content blocks (TextContent,
 * ThinkingContent, ImageContent, ToolCall). Qoder's API expects an
 * OpenAI-compatible format with some custom extensions.
 */
/**
 * Extract text content from a message, joining all text/thinking blocks.
 */
function getContentText(msg) {
    if (typeof msg.content === "string")
        return msg.content;
    if (Array.isArray(msg.content)) {
        return msg.content
            .map((c) => {
            if (c.type === "text")
                return c.text;
            if (c.type === "thinking")
                return c.thinking;
            return "";
        })
            .join("");
    }
    return "";
}
/**
 * Convert Pi's Tool[] to Qoder's tool format.
 */
export function transformTools(tools) {
    return tools.map((t) => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));
}
/**
 * Convert Pi's internal messages to Qoder's expected format.
 *
 * Handles:
 * - User messages with text and/or image content
 * - Assistant messages with text, thinking, and tool calls
 * - Tool result messages
 * - Skips error/aborted assistant messages
 */
export function transformMessagesForQoder(messages) {
    const normalizedMessages = [];
    for (const msg of messages) {
        if (isSkippableMessage(msg))
            continue;
        if (msg.role === "user") {
            normalizedMessages.push(transformUserMessage(msg));
        }
        else if (msg.role === "assistant") {
            normalizedMessages.push(transformAssistantMessage(msg));
        }
        else if (msg.role === "toolResult") {
            normalizedMessages.push(transformToolResultMessage(msg));
        }
    }
    return normalizedMessages;
}
function isSkippableMessage(msg) {
    if (msg.role !== "assistant")
        return false;
    const am = msg;
    return am.stopReason === "error" || am.stopReason === "aborted";
}
function transformUserMessage(msg) {
    let content = "";
    if (typeof msg.content === "string") {
        content = msg.content;
    }
    else if (Array.isArray(msg.content)) {
        const hasImage = msg.content.some((c) => c.type === "image");
        if (hasImage) {
            content = msg.content
                .map((c) => {
                if (c.type === "text") {
                    return { type: "text", text: c.text };
                }
                if (c.type === "image") {
                    const img = c;
                    return {
                        type: "image_url",
                        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                    };
                }
                return null;
            })
                .filter((p) => p !== null);
        }
        else {
            content = getContentText(msg);
        }
    }
    return { role: "user", content };
}
function transformAssistantMessage(am) {
    let content = "";
    const toolCalls = [];
    if (Array.isArray(am.content)) {
        for (const block of am.content) {
            if (block.type === "text") {
                content += block.text;
            }
            else if (block.type === "thinking") {
                // Skip sending previous thinking blocks for the OpenAI-compatible API.
                // Qoder current API produces reasoning_content natively during streaming;
                // re-emitting prior reasoning as <thinking> tags is unnecessary and
                // can confuse newer model versions.
            }
            else if (block.type === "toolCall") {
                const tc = block;
                toolCalls.push({
                    id: tc.id,
                    type: "function",
                    function: {
                        name: tc.name,
                        arguments: typeof tc.arguments === "string"
                            ? tc.arguments
                            : JSON.stringify(tc.arguments),
                    },
                });
            }
        }
    }
    else {
        content = am.content || "";
    }
    const mapped = {
        role: "assistant",
        content: content || null,
    };
    if (toolCalls.length > 0) {
        mapped.tool_calls = toolCalls;
    }
    return mapped;
}
function transformToolResultMessage(tr) {
    return {
        role: "tool",
        tool_call_id: tr.toolCallId,
        content: getContentText(tr),
    };
}
//# sourceMappingURL=transform.js.map