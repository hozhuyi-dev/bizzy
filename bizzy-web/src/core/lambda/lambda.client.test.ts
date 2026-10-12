import { vi } from "vitest";
import { ApiError, invoke } from "./lambda.client";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = send;
  },
  InvokeCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

function reply(body: unknown, functionError?: string) {
  send.mockResolvedValueOnce({
    Payload: new TextEncoder().encode(JSON.stringify(body)),
    FunctionError: functionError,
  });
}

describe("invoke", () => {
  test("sends the action and payload", async () => {
    reply({ data: [] });

    await invoke("clients.list", { a: 1 });

    const command = send.mock.calls[0]?.[0] as { input: { Payload: Uint8Array } };
    expect(JSON.parse(new TextDecoder().decode(command.input.Payload))).toEqual({
      action: "clients.list",
      payload: { a: 1 },
    });
  });

  test("returns data", async () => {
    reply({ data: { id: "1" } });
    await expect(invoke("clients.save")).resolves.toEqual({ id: "1" });
  });

  test("returns null for an empty result", async () => {
    reply({});
    await expect(invoke("google.status")).resolves.toBeNull();
  });

  test("throws the API's error", async () => {
    reply({ error: { code: "conflict", message: "taken" } });

    const error = await invoke("clients.save").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "conflict", message: "taken" });
  });

  test("hides function crashes behind a generic error", async () => {
    reply({ errorMessage: "runtime exited" }, "Unhandled");
    await expect(invoke("clients.list")).rejects.toMatchObject({
      code: "internal",
    });
  });
});
