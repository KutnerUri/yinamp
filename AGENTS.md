# Working instructions

Only execute work when the user's input is phrased as a command. Otherwise, or when an implementation is long, present a plan and ask for confirmation first. An explicit approval of that plan authorizes carrying it out.

## App control and testing

Use internal app APIs, Electron/Chromium automation, and isolated test processes by default.

Do not use desktop accessibility, mouse/keyboard simulation, or system-wide screenshots without the user's explicit approval. A screenshot request alone does not authorize desktop control. If internal APIs cannot perform a task, explain the limitation and ask before switching.

Tests must use disposable installations/profiles and control only the processes and files they create. Do not add production confirmation bypasses or expose debugging endpoints in normal app launches.
