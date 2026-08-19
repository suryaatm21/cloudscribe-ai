import { Request } from "express";
import {
  decodeJsonPayload,
  decodePubSubMessage,
  logRequest,
} from "../pubsubHandler";
import { logger } from "../logger";

jest.mock("../logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("pubsubHandler", () => {
  function createRequest(payload: Record<string, unknown>): Request {
    return {
      body: payload,
      headers: {},
    } as unknown as Request;
  }

  function encode(data: unknown): string {
    return Buffer.from(JSON.stringify(data)).toString("base64");
  }

  it("decodes a valid Pub/Sub message", () => {
    const data = { name: "user-video.mp4" };
    const req = createRequest({
      message: {
        data: encode(data),
      },
    });

    const decoded = decodePubSubMessage(req);
    expect(decoded).toEqual(data);
  });

  it("throws when the Pub/Sub envelope is malformed", () => {
    const req = createRequest({});
    expect(() => decodePubSubMessage(req)).toThrow(
      "No message data found in request",
    );
  });

  it("throws when message.data is missing from the envelope", () => {
    const req = createRequest({ message: { messageId: "1" } });
    expect(() => decodeJsonPayload(req)).toThrow(
      "No message data found in request",
    );
  });

  it("throws when name field is missing", () => {
    const req = createRequest({
      message: {
        data: encode({ invalid: true }),
      },
    });
    expect(() => decodePubSubMessage(req)).toThrow(
      "Missing filename in payload",
    );
  });

  it("rejects a JSON null payload", () => {
    const req = createRequest({
      message: {
        data: Buffer.from("null").toString("base64"),
      },
    });
    expect(() => decodeJsonPayload(req)).toThrow(
      "Decoded payload is not an object",
    );
  });

  it("rejects a non-object JSON payload", () => {
    const req = createRequest({
      message: {
        data: Buffer.from("[]").toString("base64"),
      },
    });
    expect(() => decodeJsonPayload(req)).toThrow(
      "Decoded payload is not an object",
    );
  });

  it("throws when the envelope body is not JSON", () => {
    const req = createRequest({
      message: {
        data: Buffer.from("not-json").toString("base64"),
      },
    });
    expect(() => decodeJsonPayload(req)).toThrow("Invalid JSON in message");
  });

  it("logs metadata for each request", () => {
    const requestHeaders = { "ce-subject": "projects/demo/subscriptions/test-sub" };
    const req = {
      body: {
        message: {
          data: encode({ name: "abc.mp4" }),
          messageId: "123",
          attributes: { attempt: "1" },
        },
      },
      headers: requestHeaders,
    } as unknown as Request;

    logRequest(req);

    expect(logger.info).toHaveBeenCalledWith(
      "Received Pub/Sub event",
      expect.objectContaining({
        jobId: "123",
        subscription: requestHeaders["ce-subject"],
        attributes: { attempt: "1" },
      }),
    );
  });
});
