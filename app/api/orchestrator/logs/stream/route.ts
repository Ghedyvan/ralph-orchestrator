import {readState} from "@/lib/orchestrator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      let lastCount = -1;
      const send = async () => {
        const state = await readState();
        if (state.logs.length !== lastCount) {
          lastCount = state.logs.length;
          controller.enqueue(
            encoder.encode(`event: logs\ndata: ${JSON.stringify({logs: state.logs.slice(-50)})}\n\n`),
          );
        }
      };

      await send();
      const interval = setInterval(() => {
        send().catch(() => {
          clearInterval(interval);
          controller.close();
        });
      }, 2000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
