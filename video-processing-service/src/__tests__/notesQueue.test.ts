jest.mock("@google-cloud/pubsub", () => {
  const publishMessage = jest.fn().mockResolvedValue("message-123");
  const topic = jest.fn().mockReturnValue({ publishMessage });
  return {
    PubSub: jest.fn().mockImplementation(() => ({ topic })),
  };
});

jest.mock("../config", () => ({
  serviceConfig: {
    notesTopicName: "notes-jobs",
  },
}));

import { publishNotesJob } from "../notesQueue";

describe("publishNotesJob", () => {
  it("publishes payload to configured topic", async () => {
    const gcsPath = await publishNotesJob({
      videoId: "video-1",
      transcriptId: "transcript-1",
      transcriptGcsPath: "gs://bucket/path",
      noteId: "transcript-1-notes",
    });
    expect(gcsPath).toBe("message-123");
  });
});
