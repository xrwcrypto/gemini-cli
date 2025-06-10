# Project Plan: Gemini CLI VS Code Extension

This document outlines the plan for creating a VS Code extension that provides an alternative, IDE-integrated user interface for the Gemini CLI.

## Guiding Principles

- **Minimize Disruption:** Prioritize additive changes. The new extension will live in its own package (`packages/vscode-extension`).
- **Architectural Purity:** Ensure the `packages/core` is completely UI-agnostic, containing only business logic.
- **Test-Driven:** Leverage and enhance existing tests to refactor safely and validate new functionality.
- **Incremental Progress:** Use git checkpoints to save progress at each logical step.

---

## Phase 1: Analysis and Preparation

**Objective:** Ensure the codebase is ready for extension and that we have a solid baseline for testing.

1.  **Analyze Test Coverage:**
    *   **Action:** Review the existing test suite in `packages/core` and `packages/cli`.
    *   **Goal:** Identify any critical logic paths that are not adequately covered by unit or integration tests. The goal is not 100% coverage, but to ensure that major refactoring can be done with confidence.
    *   **Verification:** Run the existing test suite with coverage reporting (`npm test -- --coverage`).

2.  **Architectural Review:**
    *   **Action:** Analyze the boundary between `packages/cli` and `packages/core`.
    *   **Goal:** Identify any dependencies that violate the desired separation of concerns. Specifically, look for:
        *   UI-related code or concepts in `core`.
        *   CLI-lifecycle-specific code in `core`.
        *   Core business logic located in `cli` that should be moved to `core`.
    *   **Artifact:** A list of specific refactoring tasks required to make `core` a standalone, UI-agnostic engine.

---

## Phase 2: Refactoring (If Necessary)

**Objective:** Decouple the `core` package from the `cli` package, making it a reusable engine for any UI.

1.  **Execute Refactoring Tasks:**
    *   **Action:** Address the refactoring items identified in Phase 1. This may involve moving files, adjusting function signatures, and creating new interfaces.
    *   **Process:**
        *   For each distinct refactoring, create a new git branch.
        *   Make the changes, ensuring all existing tests continue to pass.
        *   Add new tests for any moved or newly extracted logic.
        *   Commit the self-contained change.

2.  **Final Verification:**
    *   **Action:** After all refactoring is complete, run the entire project's test suite (`npm run test`) and lint checks (`npm run lint`).
    *   **Goal:** Confirm that the application's behavior has not changed and that the codebase is in a a clean state before starting new feature development.

---

## Phase 3: VS Code Extension Implementation

**Objective:** Create the VS Code extension itself, with a webview-based UI that can host a React application.

1.  **Scaffold New Package:**
    *   **Action:** Create a new directory `packages/vscode-extension`.
    *   **Action:** Initialize a new `package.json` for the extension, including dependencies on `vscode` types and our own `packages/core`.

2.  **Scaffold VS Code Extension:**
    *   **Action:** Use the standard `yo code` generator to create the basic structure of a TypeScript-based VS Code extension inside the new package.
    *   **Configuration:** Configure the extension to activate when a user runs a "Gemini Chat" command from the command palette.

3.  **Implement Webview Panel:**
    *   **Action:** Write the code to create and manage a VS Code webview panel. This panel will serve as the container for our React-based chat interface.
    *   **Action:** Set up the necessary content security policies and communication bridge for the webview.

4.  **Set Up React in Webview:**
    *   **Action:** Create a simple React application inside the `vscode-extension` package.
    *   **Action:** Configure a build process (using `esbuild` or `webpack`) to bundle the React code into a single file that can be loaded by the webview.
    *   **Goal:** Render a basic "Hello World" component inside the VS Code webview panel.

---

## Phase 4: Core Integration and UI Development

**Objective:** Connect the UI to the `core` engine and build out the conversational interface.

1.  **Integrate Core Engine:**
    *   **Action:** In the extension's activation code, import and instantiate the main class/entrypoint from `packages/core`.
    *   **Action:** Establish a message-passing system between the extension's main process (which runs the `core` engine) and the React webview.

2.  **Develop Chat UI:**
    *   **Action:** Re-use or adapt React components and hooks from `packages/cli/src/ui` to build the chat interface within the webview. This includes:
        *   Input box for user messages.
        *   Display area for conversation history (user, model, and tool messages).
        *   State management for loading indicators, tool calls, etc.
    *   **Goal:** Achieve a user experience that is consistent with the existing CLI.

---

## Phase 5: Future Architectural Evolution (Long-Running Process)

**Objective:** Document the path toward moving the `core` engine into a separate, shareable process. This phase is for planning, not immediate implementation.

1.  **Evaluation:**
    *   **Action:** Analyze different IPC (Inter-Process Communication) mechanisms.
    *   **Options:**
        *   **Language Server Protocol (LSP):** The standard for IDEs. Powerful but may be overkill if we only need simple request/response.
        *   **Custom IPC:** Using Node.js's built-in `child_process` module with `stdin`/`stdout` or a custom socket server. Simpler to start.
    *   **Recommendation:** Propose the most suitable IPC mechanism for this project's needs.

2.  **High-Level Plan:**
    *   **Step 1:** Define a clear, serializable API (e.g., using JSON) for all interactions with the `core` engine.
    *   **Step 2:** Create a new entrypoint in `core` that listens for requests via the chosen IPC mechanism and sends back responses.
    *   **Step 3:** Modify both the `cli` and `vscode-extension` packages to act as clients that communicate with this new `core` process instead of importing it directly.
