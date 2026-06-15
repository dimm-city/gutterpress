const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

export const log = {
  info(msg: string, ...args: unknown[]) {
    console.log(`${CYAN}info${RESET}  ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]) {
    console.warn(`${YELLOW}warn${RESET}  ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]) {
    console.error(`${RED}${BOLD}error${RESET} ${msg}`, ...args);
  },
  success(msg: string, ...args: unknown[]) {
    console.log(`${GREEN}ok${RESET}    ${msg}`, ...args);
  },
};
