/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { AuthDialog } from './AuthDialog.js';
import { LoadedSettings } from '../../config/settings.js';
import { AuthType } from '@gemini-cli/core';
import { useInput } from 'ink';
import { vi } from 'vitest';

vi.mock('ink', async (importOriginal) => {
  const actualInkModule = (await importOriginal()) as object;
  return { ...actualInkModule, useInput: vi.fn() };
});

describe('AuthDialog', () => {
  it('should show an error if the initial auth type is invalid', () => {
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: {
          selectedAuthType: AuthType.USE_GEMINI,
        },
        path: '',
      },
      {
        settings: {},
        path: '',
      },
      [],
    );

    const { lastFrame } = render(
      <AuthDialog
        onSelect={() => {}}
        onHighlight={() => {}}
        settings={settings}
        initialErrorMessage="GEMINI_API_KEY  environment variable not found"
        isInitialAuth={true}
        onExit={() => {}}
      />,
    );

    expect(lastFrame()).toContain(
      'GEMINI_API_KEY  environment variable not found',
    );
  });

  it('should call onExit when isInitialAuth is true and escape is pressed', () => {
    const onExit = vi.fn();
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: {},
        path: '',
      },
      {
        settings: {},
        path: '',
      },
      [],
    );

    let useInputCallback: (
      input: string,
      key: { escape: boolean },
    ) => void = () => {};
    (useInput as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      useInputCallback = callback;
    });

    const { unmount } = render(
      <AuthDialog
        onSelect={() => {}}
        onHighlight={() => {}}
        settings={settings}
        isInitialAuth={true}
        onExit={onExit}
      />,
    );

    useInputCallback('', { escape: true });
    expect(onExit).toHaveBeenCalled();
    unmount();
  });

  it('should call onSelect with undefined when isInitialAuth is false and escape is pressed', () => {
    const onSelect = vi.fn();
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: {},
        path: '',
      },
      {
        settings: {},
        path: '',
      },
      [],
    );

    let useInputCallback: (
      input: string,
      key: { escape: boolean },
    ) => void = () => {};
    (useInput as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      useInputCallback = callback;
    });

    const { unmount } = render(
      <AuthDialog
        onSelect={onSelect}
        onHighlight={() => {}}
        settings={settings}
        isInitialAuth={false}
        onExit={() => {}}
      />,
    );

    useInputCallback('', { escape: true });
    expect(onSelect).toHaveBeenCalledWith(undefined, 'User');
    unmount();
  });

  describe('Snapshots', () => {
    it('should render correctly for initial auth', () => {
      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {},
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        [],
      );

      const { lastFrame } = render(
        <AuthDialog
          onSelect={() => {}}
          onHighlight={() => {}}
          settings={settings}
          isInitialAuth={true}
          onExit={() => {}}
        />,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render correctly for user-initiated auth', () => {
      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {},
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        [],
      );

      const { lastFrame } = render(
        <AuthDialog
          onSelect={() => {}}
          onHighlight={() => {}}
          settings={settings}
          isInitialAuth={false}
          onExit={() => {}}
        />,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render correctly with an error message', () => {
      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {},
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        [],
      );

      const { lastFrame } = render(
        <AuthDialog
          onSelect={() => {}}
          onHighlight={() => {}}
          settings={settings}
          isInitialAuth={false}
          onExit={() => {}}
          initialErrorMessage="Something went wrong"
        />,
      );

      expect(lastFrame()).toMatchSnapshot();
    });

    it('should render all options when an advanced option is pre-selected', () => {
      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            selectedAuthType: AuthType.USE_VERTEX_AI,
          },
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        [],
      );

      const { lastFrame } = render(
        <AuthDialog
          onSelect={() => {}}
          onHighlight={() => {}}
          settings={settings}
          isInitialAuth={false}
          onExit={() => {}}
        />,
      );

      expect(lastFrame()).toMatchSnapshot();
    });
  });
});
