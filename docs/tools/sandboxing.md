# Sandboxing in the Gemini CLI

This document provides an overview of how sandboxing is used throughout the Gemini CLI. Sandboxing is a core security feature, running tools and commands within a restricted environment and minimizing the risk of system compromise. 

NOTE: When operating inside a sandbox, any tools, libraries, or executables that you want to use with the CLI, including MCP servers, __must be available inside__ the sandbox environment. For example, to run an MCP server using `npx`, the `npx` executable must be installed within the sandbox's Docker image. If a tool relies on a specific system utility (e.g., `ffmpeg`), that utility must also be available in the sandbox image.

## How to install sandboxing
Container-based sandboxing is highly recommended and requires, at a minimum, setting `GEMINI_SANDBOX=true` in your `~/.env` and ensuring a container engine (e.g. Docker or Podman) is available. 

To build both the gemini CLI utility and the sandbox container, run the following command from the root directory:

```
npm install
npm run build:all
```

To skip building the sandbox container, you can use `npm run build` instead.

By default, the Gemini CLI uses a pre-built `gemini-cli-sandbox` Docker image. You can create a `.gemini/sandbox.Dockerfile` file in your project to add the necessary tools and libraries to the container image. 

### MacOS Seatbelt
On MacOS, the Gemini CLI uses Seatbelt (`sandbox-exec`) under a [minimal profile](../../packages/cli/src/utils/sandbox-macos-minimal.sb) that restricts writes to the project folder but otherwise allows all other operations by default. You can switch to a [strict profile](../../packages/cli/src/utils/sandbox-macos-strict.sb) that declines operations by default by setting `SEATBELT_PROFILE=strict` in your environment or `.env` file. You can also switch to a custom profile `SEATBELT_PROFILE=<profile>` if you also create a file `.gemini/sandbox-macos-<profile>.sb` under your project settings directory `.gemini`.

### Container-based sandboxing (all platforms)
For stronger container-based sandboxing on MacOS or other platforms, you can set `GEMINI_SANDBOX=true|docker|podman|<command>` in your environment or `.env` file. The specified command (or, if selected, either Docker or Podman) must be installed on the host machine. Once enabled, `npm run build:all` will build a minimal container ("sandbox") image and `npm start` will launch inside a fresh instance of that container. Default builds (`npm run build`) will not rebuild the sandbox.

Container-based sandboxing mounts the project directory (and system temp directory) with read-write access and is started, stopped, and removed automatically as you start and stop the Gemini CLI. Files created within the sandbox should be automatically mapped to your user/group on the host machine. You can easily specify additional mounts, ports, or environment variables by setting `SANDBOX_{MOUNTS,PORTS,ENV}` as needed. You can also fully customize the sandbox for your projects by creating the files `.gemini/sandbox.Dockerfile` and/or `.gemini/sandbox.bashrc` under your project settings directory `.gemini`.

### Attaching from VS Code
With container-based sandboxing, you can have VS Code (or forks like Cursor) attach to a running sandbox container using the Dev Containers extension. Use the `Dev Containers: Attach to Running Container` command and select your container named `...-sandbox-#`. The sandbox container name should be displayed in green in the terminal when running Gemini. You may need to set the VS Code setting `dev.containers.dockerPath` if you are not using Docker. Otherwise, you may be prompted by the extension to install Docker if it is missing from your system.
