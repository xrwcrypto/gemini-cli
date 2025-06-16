# Tool Call Display UX Specification

This document outlines the user experience (UX) and rendering logic for displaying tool calls in the Gemini CLI. The goal is to create a clear, intuitive, and visually cohesive representation of tool execution that accurately reflects the conversational flow between the user, the model, and the tools.

## Guiding Principles

- **Clarity:** The display should make it obvious what tools are being executed, in what order, and whether they succeeded or failed.
- **Cohesion:** Related tool calls, even across multiple conversational turns, should be grouped together visually to represent a single logical operation.
- **Context:** The rendering should reflect the context in which the tools were called (e.g., initiated by the model after a remark vs. initiated directly after a user prompt).

## Core Scenarios

### 1. Tool Calls Following Model Output

When the model makes a remark and then executes one or more tools, the tool calls are visually connected to the model's output. This shows they are part of a continuous thought process.

**Example: A two-tool chain after a remark.**

```
> I'm testing tool call rendering. Please say a pithy remark, then run two
  chained tool calls: first, glob for a markdown file, and second, read a
  file of your choice. Afterwards, make a sassy remark about the file you read.

✦ Alright, let's kick the tires on this thing.
  ├── ✔ FindFiles '**/*.md' - Found 30 matching file(s)
  ╰── ✔ ReadFile README.md

✦ Ah, a README.md file. The humble greeting card of every repository. This one
  seems to have all its papers in order. How... quaint.
```

**Example: A three-tool chain after a remark.**

```
> Nice! Now for something similar, but with three steps. Please say a pithy
  remark, then run the following chained tool calls:
  1. Glob to find a random markdown file.
  2. Run the shell command 'ls -l | head -3'.
  3. Read a file of your choice.
  Finally, make a sassy remark about the shell command.

✦ Alright, a three-part combo. Let's see if I can do this without tripping
  over my own digital feet.
  ├── ✔ FindFiles '**/*.md' - Found 30 matching file(s)
  ├── ✔ Shell ls -l | head -3
  ╰─�� ✔ ReadFile docs/cli/commands.md

✦ Ah, ls -l | head -3. A classic "I want to see what's in here, but not,
  you know, all of it." It's the digital equivalent of peeking through the
  blinds. A little bit of information, a whole lot of plausible deniability.
```

### 2. Tool Calls Immediately After User Input

When tool calls are executed immediately after a user's prompt without any preceding model output, the rendering changes to signify a new, distinct block of action initiated by the user's request.

**Example: A three-tool chain.**

```
> This is looking great. Now, please run the same three tool calls as before,
  but do so immediately without any introductory remark. Please keep the final
  pithy comment.

  ┌── ✔ FindFiles '**/*.md' - Found 30 matching file(s)
  ├── ✔ Shell ls -l | head -3
  ╰── ✔ ReadFile CONTRIBUTING.md

✦ Ah, ls -l | head -3. A classic "I want to see what's in here, but not,
  you know, all of it." It's the digital equivalent of peeking through the
  blinds. A little bit of information, a whole lot of plausible deniability.
```

## Edge Cases and Special Scenarios

### 1. Multi-Turn Tool Calls

A critical feature of the UX is its ability to handle tool calls that occur across multiple conversational turns. If the model executes a tool, thinks, and then executes another, the UI must render this as a single, continuous chain.

This involves the UI re-rendering the previous tool call to connect it to the new one, forming a cohesive group that accurately represents the model's logical process, even though it spanned multiple turns.

**Example:**

```
> I'm testing how multi-turn tool calls are rendered. Please perform the
  following actions in sequence, with a pause for thought between each:
  1. Read the contents of a file of your choice.
  2. Read the contents of a second, different file.
  3. Read the contents of a third file.
  After completing all three reads, please list the basenames of the three files.

  ┌── ✔ ReadFile README.md
  ├── ✔ ReadFile LICENSE
  ╰── ✔ ReadFile package.json

✦ README.md, LICENSE, package.json
```

### 2. Error Reporting

Error messages are displayed inline with the tool chain, clearly indicating which tool failed without disrupting the overall structure.

**Example: Long error message.**

A longer, multi-line error is displayed on subsequent lines, indented to remain visually associated with the failed tool call. The `│` character maintains the chain's vertical line.

```
> I'm testing error rendering. Please immediately perform the following
  chained tool calls:
  1. Glob to find a random markdown file.
  2. Attempt to read the non-existent file "fake.txt".
  3. Read a file of your choice.
  Afterwards, please provide a pithy remark.

  ┌── ✔ FindFiles '**/*.md' - Found 30 matching file(s)
  ├── ✘ ReadFile fake.txt
  │     File path must be absolute, but was relative: fake.txt. You must
  │     provide an absolute path.
  ╰── ✔ ReadFile README.md
```

**Example: Short error message.**

A short, single-line error is displayed on the same line as the failed tool call for conciseness.

```
> Now, please perform a three-step tool chain. First, find all markdown
  files. Second, attempt to read the non-existent file "/foobar.txt".
  Third, read an existing file of your choice.

  ┌── ✔ FindFiles '**/*.md' - Found 30 matching file(s)
  ├── ✘ ReadFile /foobar.txt - File not found
  ╰── ✔ ReadFile README.md
```