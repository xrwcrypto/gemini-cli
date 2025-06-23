/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuthCommand } from './useAuthCommand.js';
import {
  LoadedSettings,
  SettingScope,
  type Settings,
  type SettingsFile,
} from '../../config/settings.js';
import { AuthType, Config, clearCachedCredentialFile } from '@gemini-cli/core';

// Mock dependencies with side-effects
vi.mock('@gemini-cli/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gemini-cli/core')>();
  return {
    ...actual,
    clearCachedCredentialFile: vi.fn(),
  };
});

// Mock the saveSettings function to prevent file system writes during tests.
vi.mock('../../config/settings.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../config/settings.js')>();
  return {
    ...actual,
    saveSettings: vi.fn(),
  };
});

describe('useAuthCommand', () => {
  let mockConfig: Config;
  let mockSetAuthError: ReturnType<typeof vi.fn>;

  // Helper function to create a real LoadedSettings instance for tests.
  // This avoids the type errors from using a plain object mock.
  const createMockSettings = (
    initialSettings: Settings = {},
  ): LoadedSettings => {
    const user: SettingsFile = { path: 'user.json', settings: {} };
    const workspace: SettingsFile = {
      path: 'workspace.json',
      settings: initialSettings,
    };
    return new LoadedSettings(user, workspace, []);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetAuthError = vi.fn();
    mockConfig = {
      refreshAuth: vi.fn().mockResolvedValue(undefined),
    } as unknown as Config;
  });

  it('should initialize with the auth dialog open if no auth type is selected', () => {
    // Setup: Create settings with no `selectedAuthType`.
    const mockSettings = createMockSettings({});

    const { result } = renderHook(() =>
      useAuthCommand(mockSettings, mockSetAuthError, mockConfig),
    );

    expect(result.current.isAuthDialogOpen).toBe(true);
  });

  it('should initialize with the auth dialog closed if an auth type is already selected', () => {
    // Setup: Create settings with `selectedAuthType` present.
    const mockSettings = createMockSettings({
      selectedAuthType: AuthType.USE_GEMINI,
    });

    const { result } = renderHook(() =>
      useAuthCommand(mockSettings, mockSetAuthError, mockConfig),
    );

    expect(result.current.isAuthDialogOpen).toBe(false);
  });

  describe('handleAuthSelect', () => {
    it('should set auth type and clear credentials when a method is selected', async () => {
      const mockSettings = createMockSettings();

      const setValueSpy = vi
        .spyOn(mockSettings, 'setValue')
        .mockImplementation(() => {});

      const { result } = renderHook(() =>
        useAuthCommand(mockSettings, mockSetAuthError, mockConfig),
      );
      const authMethod = AuthType.USE_GEMINI;
      const scope = SettingScope.User;

      await act(async () => {
        await result.current.handleAuthSelect(authMethod, scope);
      });

      expect(clearCachedCredentialFile).toHaveBeenCalledTimes(1);
      expect(setValueSpy).toHaveBeenCalledWith(
        scope,
        'selectedAuthType',
        authMethod,
      );
      expect(result.current.isAuthDialogOpen).toBe(false);
      expect(mockSetAuthError).toHaveBeenCalledWith(null);
    });

    it('should just close the dialog if no method is selected (e.g., escape)', async () => {
      const mockSettings = createMockSettings();
      const setValueSpy = vi.spyOn(mockSettings, 'setValue');

      const { result } = renderHook(() =>
        useAuthCommand(mockSettings, mockSetAuthError, mockConfig),
      );

      await act(async () => {
        await result.current.handleAuthSelect(undefined, SettingScope.User);
      });

      expect(clearCachedCredentialFile).not.toHaveBeenCalled();
      expect(setValueSpy).not.toHaveBeenCalled();
      expect(result.current.isAuthDialogOpen).toBe(false);
    });
  });

  describe('closeAuthDialog', () => {
    it('should close the dialog when called', () => {
      const mockSettings = createMockSettings({}); // Start with dialog open
      const { result } = renderHook(() =>
        useAuthCommand(mockSettings, mockSetAuthError, mockConfig),
      );
      expect(result.current.isAuthDialogOpen).toBe(true);

      act(() => {
        result.current.closeAuthDialog();
      });

      expect(result.current.isAuthDialogOpen).toBe(false);
    });
  });

  describe('Automatic Authentication (useEffect)', () => {
    it('should not attempt to authenticate if the dialog is open', () => {
      const mockSettings = createMockSettings({
        selectedAuthType: AuthType.USE_GEMINI,
      });
      const { result } = renderHook(() =>
        useAuthCommand(mockSettings, mockSetAuthError, mockConfig),
      );

      vi.mocked(mockConfig.refreshAuth).mockClear();

      act(() => {
        result.current.openAuthDialog();
      });

      expect(mockConfig.refreshAuth).not.toHaveBeenCalled();
    });

    it('should set an error and reopen the dialog if authentication fails', async () => {
      const errorMessage = 'Authentication failed';
      vi.mocked(mockConfig.refreshAuth).mockRejectedValue(
        new Error(errorMessage),
      );
      const mockSettings = createMockSettings({
        selectedAuthType: AuthType.LOGIN_WITH_GOOGLE_PERSONAL,
      });

      const { result } = renderHook(() =>
        useAuthCommand(mockSettings, mockSetAuthError, mockConfig),
      );

      await waitFor(() => {
        expect(result.current.isAuthDialogOpen).toBe(true);
      });

      expect(mockSetAuthError).toHaveBeenCalledWith(
        expect.stringContaining(errorMessage),
      );
      expect(result.current.isAuthenticating).toBe(false);
    });
  });
});
