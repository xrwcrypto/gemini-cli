/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import * as path from 'path';
import { glob } from 'glob';
import {
  isNodeError,
  escapePath,
  getErrorMessage,
  Config,
} from '@gemini-cli/core';
import {
  MAX_SUGGESTIONS_TO_SHOW,
  Suggestion,
} from '../components/SuggestionsDisplay.js';
import { SlashCommand } from './slashCommandProcessor.js';

export interface UseCompletionReturn {
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  visibleStartIndex: number;
  showSuggestions: boolean;
  isLoadingSuggestions: boolean;
  setActiveSuggestionIndex: React.Dispatch<React.SetStateAction<number>>;
  setShowSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
  resetCompletionState: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
}

export function useCompletion(
  query: string,
  cwd: string,
  isActive: boolean,
  slashCommands: SlashCommand[],
  config?: Config,
): UseCompletionReturn {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] =
    useState<number>(-1);
  const [visibleStartIndex, setVisibleStartIndex] = useState<number>(0);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] =
    useState<boolean>(false);

  const resetCompletionState = useCallback(() => {
    setSuggestions([]);
    setActiveSuggestionIndex(-1);
    setVisibleStartIndex(0);
    setShowSuggestions(false);
    setIsLoadingSuggestions(false);
  }, []);

  const navigateUp = useCallback(() => {
    if (suggestions.length === 0) return;

    setActiveSuggestionIndex((prevActiveIndex) => {
      // Calculate new active index, handling wrap-around
      const newActiveIndex =
        prevActiveIndex <= 0 ? suggestions.length - 1 : prevActiveIndex - 1;

      // Adjust scroll position based on the new active index
      setVisibleStartIndex((prevVisibleStart) => {
        // Case 1: Wrapped around to the last item
        if (
          newActiveIndex === suggestions.length - 1 &&
          suggestions.length > MAX_SUGGESTIONS_TO_SHOW
        ) {
          return Math.max(0, suggestions.length - MAX_SUGGESTIONS_TO_SHOW);
        }
        // Case 2: Scrolled above the current visible window
        if (newActiveIndex < prevVisibleStart) {
          return newActiveIndex;
        }
        // Otherwise, keep the current scroll position
        return prevVisibleStart;
      });

      return newActiveIndex;
    });
  }, [suggestions.length]);

  const navigateDown = useCallback(() => {
    if (suggestions.length === 0) return;

    setActiveSuggestionIndex((prevActiveIndex) => {
      // Calculate new active index, handling wrap-around
      const newActiveIndex =
        prevActiveIndex >= suggestions.length - 1 ? 0 : prevActiveIndex + 1;

      // Adjust scroll position based on the new active index
      setVisibleStartIndex((prevVisibleStart) => {
        // Case 1: Wrapped around to the first item
        if (
          newActiveIndex === 0 &&
          suggestions.length > MAX_SUGGESTIONS_TO_SHOW
        ) {
          return 0;
        }
        // Case 2: Scrolled below the current visible window
        const visibleEndIndex = prevVisibleStart + MAX_SUGGESTIONS_TO_SHOW;
        if (newActiveIndex >= visibleEndIndex) {
          return newActiveIndex - MAX_SUGGESTIONS_TO_SHOW + 1;
        }
        // Otherwise, keep the current scroll position
        return prevVisibleStart;
      });

      return newActiveIndex;
    });
  }, [suggestions.length]);

  useEffect(() => {
    if (!isActive) {
      resetCompletionState();
      return;
    }

    // Create a controller on each effect run. The cleanup function will abort
    // this controller, cancelling any in-flight glob search.
    const controller = new AbortController();
    const { signal } = controller;

    const trimmedQuery = query.trimStart(); // Trim leading whitespace

    // --- Handle Slash Command Completion ---
    if (trimmedQuery.startsWith('/')) {
      const parts = trimmedQuery.substring(1).split(' ');
      const commandName = parts[0];
      const subCommand = parts.slice(1).join(' ');

      const command = slashCommands.find(
        (cmd) => cmd.name === commandName || cmd.altName === commandName,
      );

      if (command && command.completion) {
        const fetchAndSetSuggestions = async () => {
          setIsLoadingSuggestions(true);
          if (command.completion) {
            const results = await command.completion();
            const filtered = results.filter((r) => r.startsWith(subCommand));
            const newSuggestions = filtered.map((s) => ({
              label: s,
              value: s,
            }));
            setSuggestions(newSuggestions);
            setShowSuggestions(newSuggestions.length > 0);
            setActiveSuggestionIndex(newSuggestions.length > 0 ? 0 : -1);
          }
          setIsLoadingSuggestions(false);
        };
        fetchAndSetSuggestions();
        return;
      }

      const partialCommand = trimmedQuery.substring(1);
      const filteredSuggestions = slashCommands
        .filter(
          (cmd) =>
            cmd.name.startsWith(partialCommand) ||
            cmd.altName?.startsWith(partialCommand),
        )
        // Filter out ? and any other single character commands unless it's the only char
        .filter((cmd) => {
          const nameMatch = cmd.name.startsWith(partialCommand);
          const altNameMatch = cmd.altName?.startsWith(partialCommand);
          if (partialCommand.length === 1) {
            return nameMatch || altNameMatch; // Allow single char match if query is single char
          }
          return (
            (nameMatch && cmd.name.length > 1) ||
            (altNameMatch && cmd.altName && cmd.altName.length > 1)
          );
        })
        .filter((cmd) => cmd.description)
        .map((cmd) => ({
          label: cmd.name, // Always show the main name as label
          value: cmd.name, // Value should be the main command name for execution
          description: cmd.description,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      setSuggestions(filteredSuggestions);
      setShowSuggestions(filteredSuggestions.length > 0);
      setActiveSuggestionIndex(filteredSuggestions.length > 0 ? 0 : -1);
      setVisibleStartIndex(0);
      setIsLoadingSuggestions(false);
      return;
    }

    // --- Handle At Command Completion ---
    const atIndex = query.lastIndexOf('@');
    if (atIndex === -1) {
      resetCompletionState();
      return;
    }

    const partialPath = query.substring(atIndex + 1);

    const fetchSuggestions = async () => {
      if (signal.aborted) return;
      setIsLoadingSuggestions(true);

      const fileDiscoveryService = config ? config.getFileService() : null;
      const enableRecursiveSearch =
        config?.getEnableRecursiveFileSearch() ?? true;

      if (!enableRecursiveSearch) {
        setIsLoadingSuggestions(false);
        return;
      }

      try {
        // Heuristic: If the path contains a separator, the user is likely
        // trying to complete a path. Otherwise, they are trying to find a
        // file anywhere in the project.
        const hasPathSeparators =
          partialPath.includes('/') || partialPath.includes('\\');
        const globPattern = hasPathSeparators
          ? `${partialPath}*`
          : `**/${partialPath}*`;

        const files = await glob(globPattern, {
          cwd,
          dot: partialPath.startsWith('.'),
          nocase: true,
          signal, // Pass the abort signal to the glob library.
          nodir: true, // We only want to suggest files.
        });

        // If the signal was aborted, another keypress has occurred, so we
        // should not update the state.
        if (signal.aborted) return;

        let fetchedSuggestions: Suggestion[] = files
          .map((file: string) => {
            const relativePath = path.relative(cwd, file);
            return {
              label: relativePath,
              value: escapePath(relativePath),
            };
          })
          .filter((s) => {
            if (fileDiscoveryService) {
              return !fileDiscoveryService.shouldGitIgnoreFile(s.label);
            }
            return true;
          });

        // Sort by depth, then directories first, then alphabetically
        fetchedSuggestions.sort((a, b) => {
          const depthA = (a.label.match(/\//g) || []).length;
          const depthB = (b.label.match(/\//g) || []).length;
          if (depthA !== depthB) return depthA - depthB;

          const aIsDir = a.label.endsWith('/');
          const bIsDir = b.label.endsWith('/');
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;

          return a.label.localeCompare(b.label);
        });

        // Budget the results to prevent overwhelming the UI.
        const MAX_RESULTS = 100;
        fetchedSuggestions = fetchedSuggestions.slice(0, MAX_RESULTS);

        if (!signal.aborted) {
          setSuggestions(fetchedSuggestions);
          setShowSuggestions(fetchedSuggestions.length > 0);
          setActiveSuggestionIndex(fetchedSuggestions.length > 0 ? 0 : -1);
          setVisibleStartIndex(0);
        }
      } catch (error: unknown) {
        // Silently ignore abort errors, as they are expected.
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }

        if (isNodeError(error) && error.code === 'ENOENT') {
          if (!signal.aborted) {
            setSuggestions([]);
            setShowSuggestions(false);
          }
        } else {
          console.error(
            `Error fetching completion suggestions for ${partialPath}: ${getErrorMessage(
              error,
            )}`,
          );
          if (!signal.aborted) {
            resetCompletionState();
          }
        }
      } finally {
        if (!signal.aborted) {
          setIsLoadingSuggestions(false);
        }
      }
    };

    // Debounce the search to avoid excessive calls while typing.
    const debounceTimeout = setTimeout(fetchSuggestions, 150);

    return () => {
      clearTimeout(debounceTimeout);
      controller.abort();
    };
  }, [query, cwd, isActive, resetCompletionState, slashCommands, config]);

  return {
    suggestions,
    activeSuggestionIndex,
    visibleStartIndex,
    showSuggestions,
    isLoadingSuggestions,
    setActiveSuggestionIndex,
    setShowSuggestions,
    resetCompletionState,
    navigateUp,
    navigateDown,
  };
}
