jest.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket() {
      return {
        file: () => ({
          download: async () => {
            throw new Error("not available");
          },
        }),
      };
    }
  },
}));

jest.mock("../config", () => ({
  serviceConfig: {
    promptsBucketName: "atmuri-yt-notes-prompts",
    cacheTtlMs: 1000,
  },
}));

import { loadPromptTemplate } from "../promptLoader";

describe("promptLoader", () => {
  it("loads prompt template from local filesystem when GCS fails", async () => {
    const template = await loadPromptTemplate("study-notes-v1.0.0");
    expect(template.id).toBe("study-notes-v1.0.0");
    expect(template.version).toBe("1.0.0");
    expect(template.template).toContain("Transcript");
  });
});
