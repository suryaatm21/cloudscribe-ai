import { jest } from "@jest/globals";

jest.mock("../config", () => ({
  serviceConfig: {
    enableNotes: true,
    cacheTtlMs: 1000,
  },
}));

jest.mock("../firestore", () => ({
  getGlobalFeatureFlags: jest.fn(),
  getUserSettings: jest.fn(),
}));

import { serviceConfig } from "../config";
import { getGlobalFeatureFlags, getUserSettings } from "../firestore";
import {
  isNotesFeatureGloballyEnabled,
  isUserNotesFeatureEnabled,
  shouldGenerateNotes,
} from "../featureFlags";

describe("featureFlags", () => {
  const mockedGetGlobalFeatureFlags =
    getGlobalFeatureFlags as jest.MockedFunction<typeof getGlobalFeatureFlags>;
  const mockedGetUserSettings =
    getUserSettings as jest.MockedFunction<typeof getUserSettings>;

  beforeEach(() => {
    jest.clearAllMocks();
    serviceConfig.enableNotes = true;
  });

  it("returns false when global env flag disabled", async () => {
    serviceConfig.enableNotes = false;
    await expect(isNotesFeatureGloballyEnabled()).resolves.toBe(false);
    expect(getGlobalFeatureFlags).not.toHaveBeenCalled();
  });

  it("memoizes global flag reads", async () => {
    mockedGetGlobalFeatureFlags.mockResolvedValue({ notesEnabled: true });
    await isNotesFeatureGloballyEnabled();
    await isNotesFeatureGloballyEnabled();
    expect(mockedGetGlobalFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it("checks user preference and caches result", async () => {
    mockedGetUserSettings.mockResolvedValueOnce({ notesEnabled: false });
    const first = await isUserNotesFeatureEnabled("user-1");
    const second = await isUserNotesFeatureEnabled("user-1");
    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(mockedGetUserSettings).toHaveBeenCalledTimes(1);
  });

  it("should evaluate combined flags", async () => {
    mockedGetGlobalFeatureFlags.mockResolvedValue({ notesEnabled: true });
    mockedGetUserSettings.mockResolvedValue({ notesEnabled: true });
    await expect(shouldGenerateNotes("user-2")).resolves.toBe(true);
  });
});
