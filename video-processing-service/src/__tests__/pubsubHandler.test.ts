import { Request, Response } from "express";
import { decodePubSubMessage, logRequest } from "../pubsubHandler";

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

  it("decodes a valid Pub/Sub message", () => {
    const data = { name: "user-video.mp4" };
    const req = createRequest({
      message: {
        data: Buffer.from(JSON.stringify(data)).toString("base64"),
      },
    });

    const decoded = decodePubSubMessage(req);
    expect(decoded).toEqual(data);
  });

  it("throws when payload is missing", () => {
    const req = createRequest({});
    expect(() => decodePubSubMessage(req)).toThrow("No message data found in request");
  });

  it("throws when name field is missing", () => {
    const req = createRequest({
      message: {
        data: Buffer.from(JSON.stringify({ invalid: true })).toString("base64"),
      },
    });
    expect(() => decodePubSubMessage(req)).toThrow("Missing filename in payload");
  });

  it("logs metadata for each request", () => {
    const requestHeaders = { "ce-subject": "projects/demo/subscriptions/test-sub" };
    const req = {
      body: {
        message: {
          data: Buffer.from(JSON.stringify({ name: "abc.mp4" })).toString("base64"),
          messageId: "123",
          attributes: { attempt: "1" },
        },
      },
      headers: requestHeaders,
    } as unknown as Request;

    logRequest(req);

    const logger = require("../logger").logger;
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

