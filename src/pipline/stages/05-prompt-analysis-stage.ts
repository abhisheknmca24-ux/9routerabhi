import type { PipelineContext, PipelineStage, PromptAnalysis } from '../pipeline.types.js';

/** Stage 5: Analyze the prompt for routing decisions */
export class PromptAnalysisStage implements PipelineStage {
  readonly name = 'prompt-analysis';

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.sharedRequest) return;

    const messages = ctx.sharedRequest.messages || [];
    const contentStrings = messages.map(m =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    );
    const fullText = contentStrings.join(' ');

    const analysis: PromptAnalysis = {
      modelFamily: ctx.resolvedModel?.split('/')[0] || 'unknown',
      estimatedTokens: Math.ceil(fullText.length / 4),
      hasImages: contentStrings.some(c => c.includes('image_url') || c.includes('data:image')),
      hasTools: messages.some(m => m.toolCalls !== undefined || m.toolCallId !== undefined),
      messageCount: messages.length,
      systemPromptLength: ctx.sharedRequest.system ? ctx.sharedRequest.system.length : 0,
    };

    ctx.promptAnalysis = analysis;
    ctx.metadata['promptAnalysis'] = analysis;
  }
}
