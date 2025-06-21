/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Worker } from 'worker_threads';
import {
  isNodeError,
  escapePath,
  unescapePath,
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

// The worker needs to be bundled separately.
// The path is relative to the built output directory.
const FILE_SEARCH_WORKER_PATH = new URL(
  './fileSearch.worker.js',
  import.meta.url,
).pathname;

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

  const workerRef = useRef<Worker | null>(null);
  const latestQueryRef = useRef<string>('');

  useEffect(() => {
    // Update the ref on every query change
    latestQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    // Initialize and terminate the worker
    workerRef.current = new Worker(FILE_SEARCH_WORKER_PATH);

    workerRef.current.on(
      'message',
      (msg: { query: string; files: string[]; error?: string }) => {
        // Prevent race conditions by checking if the result is for the latest query
        if (msg.query !== latestQueryRef.current) {
          return;
        }

        if (msg.error) {
          console.error(
            `Error from file search worker for query "${msg.query}": ${msg.error}`,
          );
          resetCompletionState();
          setIsLoadingSuggestions(false);
          return;
        }

        const fileDiscoveryService = config?.getFileService();

        const suggestions: Suggestion[] = msg.files
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
          })
          .slice(0, 50); // Limit results here

        // Sort by depth, then directories first, then alphabetically
        suggestions.sort((a, b) => {
          const depthA = (a.label.match(/\//g) || []).length;
          const depthB = (b.label.match(/\//g) || []).length;

          if (depthA !== depthB) {
            return depthA - depthB;
          }

          const aIsDir = a.label.endsWith('/');
          const bIsDir = b.label.endsWith('/');
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;

          return a.label.localeCompare(b.label);
        });

        setSuggestions(suggestions);
        setShowSuggestions(suggestions.length > 0);
        setActiveSuggestionIndex(suggestions.length > 0 ? 0 : -1);
        setVisibleStartIndex(0);
        setIsLoadingSuggestions(false);
      },
    );

    workerRef.current.on('error', (err) => {
      console.error('File search worker error:', err);
      setIsLoadingSuggestions(false);
    });

    workerRef.current.on('exit', (code) => {
      if (code !== 0) {
        console.error(`File search worker stopped with exit code ${code}`);
      }
    });

    return () => {
      workerRef.current?.terminate();
    };
  }, []); // Empty array ensures this runs only once on mount/unmount

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
      const newActiveIndex =
        prevActiveIndex <= 0 ? suggestions.length - 1 : prevActiveIndex - 1;

      setVisibleStartIndex((prevVisibleStart) => {
        if (
          newActiveIndex === suggestions.length - 1 &&
          suggestions.length > MAX_SUGGESTIONS_TO_SHOW
        ) {
          return Math.max(0, suggestions.length - MAX_SUGGESTIONS_TO_SHOW);
        }
        if (newActiveIndex < prevVisibleStart) {
          return newActiveIndex;
        }
        return prevVisibleStart;
      });

      return newActiveIndex;
    });
  }, [suggestions.length]);

  const navigateDown = useCallback(() => {
    if (suggestions.length === 0) return;

    setActiveSuggestionIndex((prevActiveIndex) => {
      const newActiveIndex =
        prevActiveIndex >= suggestions.length - 1 ? 0 : prevActiveIndex + 1;

      setVisibleStartIndex((prevVisibleStart) => {
        if (
          newActiveIndex === 0 &&
          suggestions.length > MAX_SUGGESTIONS_TO_SHOW
        ) {
          return 0;
        }
        const visibleEndIndex = prevVisibleStart + MAX_SUGGESTIONS_TO_SHOW;
        if (newActiveIndex >= visibleEndIndex) {
          return newActiveIndex - MAX_SUGGESTIONS_TO_SHOW + 1;
        }
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

    const trimmedQuery = query.trimStart();

    // --- Handle Slash Command Completion ---
    if (trimmedQuery.startsWith('/')) {
      // (Keep existing slash command logic, it's synchronous)
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
        .filter((cmd) => {
          const nameMatch = cmd.name.startsWith(partialCommand);
          const altNameMatch = cmd.altName?.startsWith(partialCommand);
          if (partialCommand.length === 1) {
            return nameMatch || altNameMatch;
          }
          return (
            (nameMatch && cmd.name.length > 1) ||
            (altNameMatch && cmd.altName && cmd.altName.length > 1)
          );
        })
        .filter((cmd) => cmd.description)
        .map((cmd) => ({
          label: cmd.name,
          value: cmd.name,
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
    const lastSlashIndex = partialPath.lastIndexOf('/');
    const baseDirRelative =
      lastSlashIndex === -1
        ? '.'
        : partialPath.substring(0, lastSlashIndex + 1);
    const prefix = unescapePath(
      lastSlashIndex === -1
        ? partialPath
        : partialPath.substring(lastSlashIndex + 1),
    );

    const baseDirAbsolute = path.resolve(cwd, baseDirRelative);

    const fetchSuggestions = async () => {
      setIsLoadingSuggestions(true);

      const fileDiscoveryService = config ? config.getFileService() : null;

      try {
        // If there's no slash, do a recursive search from cwd using the worker
        if (partialPath.indexOf('/') === -1 && prefix) {
          workerRef.current?.postMessage({ query, prefix, cwd });
        } else {
          // Original behavior for specific directory listing (fast, no worker needed)
          const lowerPrefix = prefix.toLowerCase();
          const entries = await fs.readdir(baseDirAbsolute, {
            withFileTypes: true,
          });

          const filteredEntries = [];
          for (const entry of entries) {
            if (!prefix.startsWith('.') && entry.name.startsWith('.')) {
              continue;
            }
            if (!entry.name.toLowerCase().startsWith(lowerPrefix)) continue;

            const relativePath = path.relative(
              cwd,
              path.join(baseDirAbsolute, entry.name),
            );
            if (
              fileDiscoveryService &&
              fileDiscoveryService.shouldGitIgnoreFile(relativePath)
            ) {
              continue;
            }

            filteredEntries.push(entry);
          }

          const fetchedSuggestions = filteredEntries.map((entry) => {
            const label = entry.isDirectory() ? entry.name + '/' : entry.name;
            return {
              label,
              value: escapePath(label),
            };
          });

          // Sort here since this path doesn't use the worker
          fetchedSuggestions.sort((a, b) => {
            const aIsDir = a.label.endsWith('/');
            const bIsDir = b.label.endsWith('/');
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.label.localeCompare(b.label);
          });

          setSuggestions(fetchedSuggestions);
          setShowSuggestions(fetchedSuggestions.length > 0);
          setActiveSuggestionIndex(fetchedSuggestions.length > 0 ? 0 : -1);
          setVisibleStartIndex(0);
          setIsLoadingSuggestions(false);
        }
      } catch (error: unknown) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          setSuggestions([]);
          setShowSuggestions(false);
        } else {
          console.error(
            `Error fetching completion suggestions for ${partialPath}: ${getErrorMessage(
              error,
            )}`,
          );
          resetCompletionState();
        }
        setIsLoadingSuggestions(false);
      }
    };

    const debounceTimeout = setTimeout(fetchSuggestions, 100);

    return () => {
      clearTimeout(debounceTimeout);
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
