/**
 * Stage 14: Anthropic Response Formatter
 *
 * A thin adapter that converts the pipeline's SharedResponse into
 * exact Anthropic /v1/messages JSON format. Does NOT duplicate any
 * routing, provider, health, or combo logic — those all happen in
 * earlier stages (1-13).
 *
 * This stage only runs when the incoming protocol is anthropic-messages.
 */

import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import { AnthropicFormatter } from '../../formatter/anthropic-formatter.js';

export class AnthropicFormatterStage implements PipelineStage {
  readonly name = 'anthropic-formatter';
  private readonly formatter = new AnthropicFormatter();

  async execute(ctx: PipelineContext): Promise<void> {
    // Only format if the client speaks Anthropic
    if (ctx.clientInfo?.protocol !== 'anthropic-messages') return;
    if (!ctx.responseData) return;
    if (ctx.error) return;

    const response = this.formatter.formatResponse({
      model: ctx.sharedRequest?.model ?? '',
      content: ctx.responseData.content,
      finishReason: ctx.responseData.finishReason,
      inputTokens: ctx.responseData.usage?.inputTokens,
      outputTokens: ctx.responseData.usage?.outputTokens,
    });

    // Serialize to JSON and overwrite the response
    ctx.responseData = {
      content: JSON.stringify(response),
      finishReason: 'stop',
      model: ctx.sharedRequest?.model ?? '',
    };

    ctx.metadata['anthropicFormatted'] = true;
  }
}
