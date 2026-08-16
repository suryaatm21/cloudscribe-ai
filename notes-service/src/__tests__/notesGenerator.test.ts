jest.mock("../config", () => ({
  serviceConfig: {
    notesPromptId: "study-notes-v1.0.0",
    cacheTtlMs: 1000,
  },
}));

jest.mock("../vertexai", () => ({
  generateNotesMarkdown: jest.fn(),
}));

import { buildPromptText } from "../notesGenerator";

describe("buildPromptText", () => {
  it("replaces placeholders with transcript metadata", () => {
    const template = "Summary for {{videoId}} lasting {{duration}}: \n{{transcript}}";
    const transcript = {
      videoId: "video-123",
      durationSeconds: 360,
      segments: [
        { text: "Intro", startTime: 0, endTime: 10 },
        { text: "Concept A", startTime: 15, endTime: 45 },
      ],
    };
    const result = buildPromptText(template, transcript);
    expect(result).toContain("video-123");
    expect(result).toContain("6 minutes");
    expect(result).toContain("Intro");
    expect(result).toContain("Concept A");
  });
});
