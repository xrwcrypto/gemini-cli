# Gemini CLI Conversation Context Architecture

This document outlines a proposed redesign of the Gemini CLI's internal state management system. The goal is to move from a simple, linear array of conversation turns to a richer, tree-based **Conversation Context** model. This enables more advanced context management, subtasking, extensibility, and intelligent history manipulation.

## The Problem with Linear History

The current system represents the chat history as a flat array of `Content` objects. This structure is simple but has significant limitations:

1.  **Loss of Application-Level Context:** It only stores *what* was said, not *why* or *how*. We lose critical context, such as whether a piece of content is a tool call, a file's content, or a user message.
2.  **Inability to Handle Subtasks:** A flat array cannot naturally represent branching conversations, subtasks, or parallel lines of reasoning.
3.  **Inefficient Context Management:** It's difficult to implement sophisticated context strategies, like "ambient" file tracking or history compression.
4.  **Poor Extensibility:** A simple array is difficult for extensions to safely inspect or modify.

## Proposed Solution: The Conversation Context Model

We propose a new core object, the `ConversationContext`, which manages the state of the conversation. This object contains the **Context Tree** (a tree of `TurnNode` objects) and a **Staging Area** for the upcoming turn.

### Core Components

1.  **`ConversationContext` Object:** This is the main stateful object for a chat session. It is responsible for:
    *   Holding the `rootNode` of the Context Tree.
    *   Tracking the `currentNodeId`, which is a pointer to the user's current position in the tree.
    *   Managing a `stagingArea` for the "upcoming" turn, where local commands (e.g., `@file.txt`, `/subtask`) can add context before the turn is sent to the model.

2.  **`TurnNode`:** The fundamental building block of the tree. Each node is a unique, timestamped event. It contains links to its parent and children, allowing for a branching structure.

3.  **`TurnPayload`:** A discriminated union that describes the specific type of event (e.g., `UserMessage`, `ToolCall`, `FileContext`, `TaskBoundary`).

4.  **`TurnMetadata`:** A container for application-level annotations, vital for internal logic.

### Turn Lifecycle

1.  **Input & Local Processing:** The user types a message. The CLI front-end parses this input for special "local commands."
2.  **Staging & Pre-processing:** Each local command is processed (e.g., a file is read) and the result is added as a `TurnPayload` to the `stagingArea`. For file-based context, this step also initiates background uploads to the Gemini File API.
3.  **Execution:** When the user submits their turn, the user's text and all staged payloads are combined into a new set of `TurnNode`s, which are appended to the tree at the `currentNodeId`.
4.  **Rendering:** A **Context Renderer** traverses the tree from the new current node back to the root. It applies transformation rules, filters nodes, and intelligently decides whether to reference a cached file via the File API or embed its content directly. The final output is the flat `Content[]` array required by the GenAI API.
5.  **Reconstitution:** The model's response (including any tool calls) is received. It is parsed and converted back into new, typed `TurnNode`s, which are added to the tree.

### Advanced Capabilities and New Tooling

The Conversation Context model unlocks a new class of tools for managing the flow of the conversation itself. These tools can be used by both the user (via slash commands) and the model (via tool calls).

#### Task & Subtask Management

The tree structure is ideal for managing complex, multi-step tasks. A dedicated set of tools can manipulate the task tree:

*   `/task start [name]`: Creates a new subtask, which starts a new branch in the context tree. This command would create a `TaskBoundaryTurn` and could specify a `HistoryTransformation` (e.g., `clear`, `clone`, `compress`) to control the context inherited by the new branch.
*   `/task complete [summary]`: Marks the current task branch as complete by adding a `TaskSummaryTurn` to the parent branch. This new node acts as a "merge commit," providing a concise summary while linking to the full history of the subtask, which is preserved.
*   `/task cancel`: Prunes the current task branch from the tree, effectively undoing it. The `currentNodeId` would revert to the parent branch's last node.
*   `/task pop`: Pauses the current task and moves the `currentNodeId` back to the parent branch. The subtask's branch remains in the tree, allowing the user or model to resume it later by navigating back to it.
*   `/task list`: Displays a visual representation of the task tree, showing active, paused, and completed branches.
*   `/task restart [hint]`: Creates a new branch from the parent of the current (failed) task, seeding it with the original context plus a new hint. This allows for iterative retries without losing the history of previous attempts.

#### Ambient File Context Management

These tools manage the set of files that the model is "aware of" without needing to have their content in every prompt.

*   `/file track [file_path]`: Adds a file to the ambient context. This command would create a `ContextManagementTurn` with a `track_file` action and could trigger a background upload to the File API.
*   `/file untrack [file_path]`: Removes a file from the ambient context via a `ContextManagementTurn`.
*   `/file list`: Lists all currently tracked ambient files.

#### History and Context Navigation

The tree structure allows for powerful navigation and inspection tools:

*   `/history view`: Renders a debug view of the entire `ConversationContext` tree, showing turn types, metadata, and relationships.
*   `/history rewind [turn_id]`: Moves the `currentNodeId` to a previous point in the tree, allowing the user to effectively "rewind" the conversation and explore an alternate path from that point.
*   `/history summarize_branch`: Uses the model to create a summary of the current task branch and injects it as a new node.
*   `/history expand_task [task_id]`: A tool for the model to dynamically request the full history of a completed subtask that has been summarized. This works by adding a temporary override to the `ContextRenderer`, which will then render the full content of the referenced branch for the next turn instead of its summary. This allows the model to "re-open" a task to get more detail when needed, without permanently altering the history tree.

These tools transform the chat from a simple linear dialogue into a dynamic workspace for complex problem-solving.

#### Intelligent File Management with the File API

To optimize performance and reduce context size, our `FileContentTurn` will integrate with the Gemini File API.
-   **Caching:** When a file is added to the context, we will upload it to the File API in the background. The resulting `fileUri` is stored on the `FileContentTurn` node.
-   **Content Hashing:** We store a hash of the file's content to detect changes. If the same file (with the same hash) is referenced again, we reuse the existing `fileUri` without re-uploading, taking advantage of the File API's 48-hour cache.
-   **Smart Rendering:** The `Context Renderer` will prioritize using the `fileUri` to reference the file. It will only fall back to embedding the file's content directly if the upload is still pending or has failed, ensuring both performance and resilience.

#### Extensibility

To ensure the system is extensible, the `TurnMetadata` object will include a generic `custom` property. This allows extensions to attach their own typed data to any turn without modifying the core data structures, ensuring forward compatibility and preventing conflicts.

#### Debugging and Serialization

The tree structure is ideal for debugging. A **Debug Renderer** can be implemented to walk the `ConversationContext` tree and serialize it to a human-readable text format (e.g., YAML or an indented outline). This will provide a clear, hierarchical view of the entire conversation state, including all payloads and metadata, which is invaluable for development and troubleshooting.

### Data Structure Location

The specific data structures for this new model are defined in `packages/core/src/history/types.ts`.

## Implementation Plan

This plan outlines the steps to replace the current linear history (`Content[]`) with our new `ConversationContext` tree structure. The migration will be focused on `packages/core` and will be designed to minimize disruption to the `packages/cli` UI.

### Phase 1: Create the Context Management Foundation

This phase is about building the core data structures and the helper functions to manage them.

1.  **Create `packages/core/src/context/manager.ts`:**
    *   This new file will contain the `ContextManager` class.
    *   **`ContextManager` Class:**
        *   It will hold the `ConversationContext` object.
        *   **`constructor()`**: Creates the initial `ConversationContext`. The `rootNode` should be a `TaskBoundaryTurn` representing the start of the main session.
        *   **`expansionOverrides`**: Will contain a set of `TurnNode` IDs that the `ContextRenderer` should temporarily expand, ignoring their summaries. This is the mechanism for the `/history expand_task` tool.
        *   **`getCurrentNode()`**: Returns the `TurnNode` corresponding to `currentNodeId`.
        *   **`addToStagingArea(payload: TurnPayload)`**: Adds a payload to the `stagingArea`.
        *   **`commitStagedItems(userMessage: string): TurnNode`**: Commits staged items to the tree and returns the new active node.
        *   **`addNode(payload: TurnPayload, parentId?: string): TurnNode`**: A helper to create and add a single new node to the tree.

2.  **Create `packages/core/src/context/renderer.ts`:**
    *   This new file will be responsible for converting our tree into the format the GenAI API understands.
    *   **`renderContext(context: ConversationContext): Content[]`**:
        *   Starts at the `context.currentNodeId` and traverses up the tree to the root.
        *   Checks the `ContextManager.expansionOverrides` set to determine if any `TaskSummaryTurn` nodes should be fully expanded instead of summarized.
        *   Applies `HistoryTransformation` rules from any `TaskBoundaryTurn` nodes it encounters.
        *   Filters nodes based on `metadata.isHiddenFromLlm`.
        *   Transforms payloads into the `Content[]` format, handling the `fileApi` logic for `FileContentTurn`.

3.  **Create New Tools in `packages/core/src/tools/`:**
    *   Implement the new context-aware tools (`task_start`, `task_complete`, `expand_task_summary`, etc.) as new tool classes.
    *   These tools will interact directly with the `ContextManager` to manipulate the conversation state (e.g., creating branches, adding summary nodes, setting expansion overrides).

### Phase 2: Integrate `ContextManager` into the Core Logic

This phase involves replacing the old `GeminiChat` with our new system.

1.  **Modify `packages/core/src/core/client.ts`:**
    *   **Replace `private chat: Promise<GeminiChat>` with `private contextManager: ContextManager`**.
    *   The `GeminiClient` constructor will now instantiate `ContextManager`.
    *   **Update `startChat()` (rename to `initializeContext()`):** This method will now be responsible for creating the initial `TurnNode`s and setting up the `ContextManager`.
    *   **Update `sendMessageStream()`:** This will be the core integration point, using the `ContextManager` to commit staged items and the `ContextRenderer` to generate the prompt for the API.
    *   **Deprecate `addHistory`, `getHistory`, `setHistory`:** These methods will be removed.

2.  **Deprecate `packages/core/src/core/geminiChat.ts`:**
    *   This class will be entirely replaced by the new context management system.

### Phase 3: Adapt the UI (`packages/cli`)

The goal here is to make the UI consume the new context structure with minimal changes to the UI components themselves.

1.  **Modify `packages/cli/src/ui/hooks/useGeminiStream.ts`:**
    *   This hook is the primary interface between the UI and the `GeminiClient`. It will be updated to call the new methods on `GeminiClient`.

2.  **Modify `packages/cli/src/ui/App.tsx`:**
    *   The `useHistory` hook will be replaced with a `useContextTree` hook that manages the state of the `ConversationContext` tree on the client side.
    *   The rendering logic will be updated to walk the `TurnNode` tree instead of a flat array, which will naturally handle the visual representation of subtasks.
