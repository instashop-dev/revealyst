// Vendor module registration — importing this module populates the
// registry (the worker entrypoint imports it for its side effect). One
// import line per vendor as W1-D/W2-J land them.
import { registerConnector } from "./registry";
import { anthropicConsoleEntry } from "./anthropic";
import { copilotEntry } from "./copilot";
import { cursorEntry } from "./cursor";
import { openAiEntry } from "./openai";

registerConnector(anthropicConsoleEntry);
registerConnector(openAiEntry);
registerConnector(cursorEntry);
registerConnector(copilotEntry);
