"use server";

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { pull } from "langchain/hub";
import { createStreamableValue } from "ai/rsc";
import { boundingBoxesTool } from "@/app/tools/boundingBoxes";

export async function runAgent(input: string) {
  "use server";

  const stream = createStreamableValue();

  (async () => {
    const tools = [boundingBoxesTool];

    const prompt = await pull<ChatPromptTemplate>(
      "hwchase17/openai-tools-agent",
    );

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
    });

    const agent = createToolCallingAgent({
      llm,
      tools,
      prompt,
    });

    const agentExecutor = new AgentExecutor({
      agent,
      tools,
    });

    const streamingEvents = agentExecutor.streamEvents(
      {
        input,
      },
      {
        version: "v2",
      },
    );

    for await (const item of streamingEvents) {
      stream.update(JSON.parse(JSON.stringify(item, null, 2)));
    }

    stream.done();
  })();

  return { streamData: stream.value };
}