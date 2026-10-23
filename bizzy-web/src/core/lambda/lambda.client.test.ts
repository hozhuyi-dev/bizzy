import { vi } from "vitest";
import { ApiError, invoke, keeping, onChanged } from "./lambda.client";

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
    $metadata: { requestId: "req-1" },
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
    await expect(invoke("clients.get")).resolves.toEqual({ id: "1" });
  });

  test("returns null for an empty result", async () => {
    reply({});
    await expect(invoke("sessions.get")).resolves.toBeNull();
  });

  test("throws the API's error", async () => {
    reply({ error: { code: "refused", message: "taken" } });

    const error = await invoke("clients.get").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "refused", message: "taken" });
  });

  test("says which call failed, and its request id", async () => {
    reply({ error: { code: "refused", message: "taken" } });
    await expect(invoke("clients.get")).rejects.toMatchObject({
      trace: { action: "clients.get", requestId: "req-1" },
    });
  });

  test("says plainly when the API can't be reached, keeping the cause", async () => {
    const cause = new TypeError("Failed to fetch");
    send.mockRejectedValueOnce(cause);
    await expect(invoke("clients.list")).rejects.toMatchObject({
      code: "unreachable",
      cause,
      trace: { action: "clients.list" },
    });
  });

  test("says it is busy when Lambda throttles", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("Rate exceeded"), { name: "TooManyRequestsException" }));
    await expect(invoke("clients.list")).rejects.toMatchObject({ code: "busy" });
  });

  test("tells the listener what a call changed, even when refused", async () => {
    const heard: Array<[ReadonlyArray<string>, unknown]> = [];
    onChanged((changed, keep) => heard.push([changed, keep]));

    reply({ data: null, changed: ["SESSION"] });
    await keeping(["sessions", "detail", "1"], () => invoke("sessions.saveRecord"));
    reply({ error: { code: "refused", message: "no" }, changed: ["CLIENT"] });
    await invoke("clients.update").catch(() => undefined);
    reply({ data: [] });
    await invoke("clients.list");

    expect(heard).toEqual([
      [["SESSION"], [["sessions", "detail", "1"]]],
      [["CLIENT"], []],
    ]);
  });

  test("hides function crashes behind a generic error", async () => {
    reply({ errorMessage: "runtime exited" }, "Unhandled");
    await expect(invoke("clients.list")).rejects.toMatchObject({
      code: "internal",
    });
  });
});
