/** What `--help` prints. */
export const USAGE = `empire-ts-aqueduct - an experimental in-memory queue broker

Usage:
  empire-ts-aqueduct --config <file>

Options:
  -c, --config <file>   Path to the JSON config file (required)
  -h, --help            Show this help

The config file declares the ports, the queues and their tokens. A token may be
written as { "env": "VARIABLE" } to read it from the environment instead of
keeping it in the file. See the README for the full list of settings.
`;
